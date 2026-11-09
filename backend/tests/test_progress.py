"""
The progress channel: what the backend says about an Analysis while it runs.

/analyze blocks and answers once, so the only way for the interface to show
where a 60-second (median) to 3-minute (p90) wait has got to is to ask a
second, short request. These tests pin the contract of that channel: it
reports stages, never a fraction, it is silent outside an Analysis, and it
leaves nothing behind.
"""
import threading

import pytest
from fastapi.testclient import TestClient

from backend.app import progress
from backend.app.api import main as api_main


@pytest.fixture(autouse=True)
def clean_state():
    progress._state.clear()
    yield
    progress._state.clear()


class TestReport:
    def test_is_a_no_op_outside_an_analysis(self):
        # The evaluation scripts call the same pipeline code with no request
        # around it. Reporting must cost them nothing and break nothing.
        progress.report("classifying")
        assert progress._state == {}

    def test_an_analysis_starts_out_queued(self):
        with progress.track("tok"):
            snapshot = progress.snapshot("tok")
        assert snapshot["stage"] == "queued"

    def test_report_moves_the_stage_and_carries_detail(self):
        with progress.track("tok"):
            progress.report("writing", attempt=2, tokens=41)
            snapshot = progress.snapshot("tok")
        assert snapshot["stage"] == "writing"
        assert snapshot["attempt"] == 2
        assert snapshot["tokens"] == 41

    def test_a_new_stage_forgets_the_last_stages_detail(self):
        # tokens belong to a writing attempt; they must not leak into the next
        # stage's snapshot as if they were still true.
        with progress.track("tok"):
            progress.report("writing", attempt=1, tokens=41)
            progress.report("writing", attempt=2)
            snapshot = progress.snapshot("tok")
        assert snapshot["attempt"] == 2
        assert "tokens" not in snapshot

    def test_the_snapshot_never_carries_a_fraction(self):
        with progress.track("tok"):
            progress.report("writing", tokens=10)
            snapshot = progress.snapshot("tok")
        for key in snapshot:
            assert "percent" not in key and "fraction" not in key and "eta" not in key

    def test_leaving_the_analysis_removes_it(self):
        with progress.track("tok"):
            progress.report("saliency")
        assert progress.snapshot("tok") is None
        assert progress._state == {}

    def test_a_failed_analysis_is_removed_too(self):
        with pytest.raises(RuntimeError):
            with progress.track("tok"):
                raise RuntimeError("the pipeline fell over")
        assert progress._state == {}

    def test_reports_reach_only_the_analysis_on_their_own_thread(self):
        # Two requests can be in flight (one running, one waiting for the
        # graphics card). A report from one must not land on the other.
        seen = {}
        started = threading.Event()
        release = threading.Event()

        def other_request():
            with progress.track("other"):
                started.set()
                release.wait(timeout=5)

        thread = threading.Thread(target=other_request)
        thread.start()
        assert started.wait(timeout=5)
        try:
            with progress.track("mine"):
                progress.report("classifying")
                seen["mine"] = progress.snapshot("mine")["stage"]
                seen["other"] = progress.snapshot("other")["stage"]
        finally:
            release.set()
            thread.join()

        assert seen == {"mine": "classifying", "other": "queued"}


class TestEndpoint:
    @pytest.fixture
    def client(self):
        return TestClient(api_main.app)

    def test_unknown_token_is_a_200_with_no_stage(self, client):
        # Not a 404: the interface asks once a second from the moment /analyze
        # is sent, and the first ask can land before the handler has registered
        # the token. A 404 there would be a red line in the console for a
        # perfectly healthy start.
        response = client.get("/progress/never-seen")
        assert response.status_code == 200
        assert response.json() == {"stage": None}

    def test_reports_the_stage_of_a_running_analysis(self, client):
        with progress.track("tok"):
            progress.report("loading")
            body = client.get("/progress/tok").json()
        assert body["stage"] == "loading"

    def test_reports_how_long_the_analysis_has_been_running(self, client):
        with progress.track("tok"):
            body = client.get("/progress/tok").json()
        assert body["elapsed_seconds"] >= 0


class TestPipelineStages:
    def test_the_pipeline_reports_its_stages_in_the_order_they_run(self, monkeypatch, tmp_path):
        import numpy as np

        from backend.app import pipeline

        crop = np.zeros((224, 224, 3), dtype=np.uint8)
        order = []

        monkeypatch.setattr(pipeline, "HEATMAP_DIR", str(tmp_path))
        monkeypatch.setattr(pipeline, "classify",
                            lambda _crop: order.append(progress.snapshot("tok")["stage"]) or {"fake_score": 0.9})
        monkeypatch.setattr(pipeline, "get_heatmap",
                            lambda _crop: order.append(progress.snapshot("tok")["stage"]) or crop)
        monkeypatch.setattr(pipeline, "unload_cam", lambda: None)
        monkeypatch.setattr(pipeline, "unload_model", lambda: None)
        monkeypatch.setattr(
            pipeline, "run_reasoning",
            lambda *_a, **_k: {"verdict": "fake", "confidence": 0.9, "signals": [], "explanation": "x"},
        )

        with progress.track("tok"):
            assert progress.snapshot("tok")["stage"] == "queued"
            pipeline.run_pipeline_from_crop(crop, 1, 0)

        # Each stage was the current one while its own work was running.
        assert order == ["classifying", "saliency"]
