"""
/detect and /analyze, exercised through the real FastAPI app.

Detection is left real — it is ~0.2s on this hardware's default CPU config
(ADR 0011) and InsightFace's buffalo_l weights are already on disk, so there
is no reason to fake it. run_pipeline_from_crop() is mocked in every /analyze
test: it is the classifier + Grad-CAM + Qwen3-VL half, 15-90s and the one
documented to crash intermittently at model load, and none of that is what
these tests are checking. What they check is the contract between the two
requests — the token, the face list, and that a token is spent once.
"""
import os

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.api import main as api_main

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "deepfake_faces")
ONE_FACE_IMAGE = os.path.join(DATA_DIR, "real", "test_00000000.png")

requires_sample_image = pytest.mark.skipif(
    not os.path.exists(ONE_FACE_IMAGE),
    reason="dataset not downloaded — see scripts/download_dataset.py",
)


@pytest.fixture
def client():
    return TestClient(api_main.app)


@pytest.fixture(autouse=True)
def clean_pending():
    """Isolation: a failed test must not leak a token into the next one."""
    api_main._pending.clear()
    yield
    for path, _faces in api_main._pending.values():
        if os.path.exists(path):
            os.remove(path)
    api_main._pending.clear()


def _fake_pipeline_result(crop_bgr, face_count):
    return {
        "final_verdict": "real",
        "fake_probability": 0.1,
        "final_confidence": 0.9,
        "classifier_score": 0.1,
        "explanation_available": True,
        "signals": [],
        "explanation": "stub",
        "heatmap_url": "/static/heatmaps/stub.png",
        "faces_found": face_count,
        "elapsed_seconds": 0.0,
    }


def _blank_jpeg(tmp_path, name="blank.jpg"):
    """A uniform grey square. Real photos have detectable faces; this doesn't
    have anything InsightFace could find, which is what the no-face test wants."""
    path = tmp_path / name
    cv2.imwrite(str(path), np.full((64, 64, 3), 200, dtype=np.uint8))
    return path


class TestDetect:
    def test_no_face_returns_an_empty_list_and_cleans_up(self, client, tmp_path):
        blank = _blank_jpeg(tmp_path)
        with open(blank, "rb") as f:
            response = client.post("/detect", files={"file": ("blank.jpg", f, "image/jpeg")})

        assert response.status_code == 200
        assert response.json() == {"faces": []}
        # Nothing left pending for a photo that produced nothing to choose from.
        assert api_main._pending == {}

    @requires_sample_image
    def test_one_face_returns_a_token_and_one_bbox(self, client):
        with open(ONE_FACE_IMAGE, "rb") as f:
            response = client.post("/detect", files={"file": ("test.png", f, "image/png")})
        body = response.json()

        assert response.status_code == 200
        assert len(body["faces"]) == 1
        face = body["faces"][0]
        assert face["index"] == 0
        assert len(face["bbox"]) == 4
        assert 0.0 <= face["det_score"] <= 1.0
        assert face["width"] > 0 and face["height"] > 0

        token = body["token"]
        assert token in api_main._pending
        path, faces = api_main._pending[token]
        assert os.path.exists(path)
        assert faces == [
            {"bbox": face["bbox"], "det_score": face["det_score"]},
        ]


class TestAnalyze:
    def test_unknown_token_is_404(self, client):
        response = client.post("/analyze", data={"token": "does-not-exist", "face_index": 0})
        assert response.status_code == 404

    def test_out_of_range_face_index_is_400_and_cleans_up_the_upload(
        self, client, tmp_path
    ):
        upload = tmp_path / "photo.jpg"
        cv2.imwrite(str(upload), np.full((64, 64, 3), 128, dtype=np.uint8))
        token = "t-out-of-range"
        api_main._pending[token] = (
            str(upload),
            [{"bbox": [0, 0, 10, 10], "det_score": 0.9}],
        )

        response = client.post("/analyze", data={"token": token, "face_index": 5})

        assert response.status_code == 400
        assert token not in api_main._pending
        assert not os.path.exists(upload)

    @requires_sample_image
    def test_valid_token_runs_the_pipeline_on_the_chosen_crop(self, client, monkeypatch):
        calls = []
        monkeypatch.setattr(
            api_main,
            "run_pipeline_from_crop",
            lambda crop_bgr, face_count: calls.append((crop_bgr.shape, face_count))
            or _fake_pipeline_result(crop_bgr, face_count),
        )

        with open(ONE_FACE_IMAGE, "rb") as f:
            detected = client.post("/detect", files={"file": ("test.png", f, "image/png")})
        token = detected.json()["token"]
        upload_path, _ = api_main._pending[token]

        response = client.post("/analyze", data={"token": token, "face_index": 0})

        assert response.status_code == 200
        assert response.json()["faces_found"] == 1
        assert calls == [((224, 224, 3), 1)]
        # Single-use: the temp upload and the pending entry are both gone.
        assert not os.path.exists(upload_path)
        assert token not in api_main._pending

    @requires_sample_image
    def test_a_spent_token_cannot_be_replayed(self, client, monkeypatch):
        monkeypatch.setattr(
            api_main, "run_pipeline_from_crop", lambda crop_bgr, face_count: _fake_pipeline_result(crop_bgr, face_count)
        )
        with open(ONE_FACE_IMAGE, "rb") as f:
            detected = client.post("/detect", files={"file": ("test.png", f, "image/png")})
        token = detected.json()["token"]

        first = client.post("/analyze", data={"token": token, "face_index": 0})
        second = client.post("/analyze", data={"token": token, "face_index": 0})

        assert first.status_code == 200
        assert second.status_code == 404
