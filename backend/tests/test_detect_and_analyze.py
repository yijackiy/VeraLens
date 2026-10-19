"""
/detect and /analyze, exercised through the real FastAPI app.

Detection is left real — it is ~0.2s on this hardware's default CPU config
(ADR 0011) and InsightFace's buffalo_l weights are already on disk, so there
is no reason to fake it. run_pipeline_from_crop() is mocked in every /analyze
test: it is the classifier + Grad-CAM + Qwen3-VL half, a minute at the median and the one
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
from backend.app.preprocessing import face_pipeline
from backend.app.preprocessing.face_pipeline import recommended_face_index

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


def _fake_pipeline_result(crop_bgr, face_count, face_index=0):
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
        "face_index": face_index,
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
            lambda crop_bgr, face_count, face_index: calls.append(
                (crop_bgr.shape, face_count, face_index)
            )
            or _fake_pipeline_result(crop_bgr, face_count, face_index),
        )

        with open(ONE_FACE_IMAGE, "rb") as f:
            detected = client.post("/detect", files={"file": ("test.png", f, "image/png")})
        token = detected.json()["token"]
        upload_path, _ = api_main._pending[token]

        response = client.post("/analyze", data={"token": token, "face_index": 0})

        assert response.status_code == 200
        assert response.json()["faces_found"] == 1
        assert calls == [((224, 224, 3), 1, 0)]
        # Single-use: the temp upload and the pending entry are both gone.
        assert not os.path.exists(upload_path)
        assert token not in api_main._pending

    @requires_sample_image
    def test_a_spent_token_cannot_be_replayed(self, client, monkeypatch):
        monkeypatch.setattr(
            api_main,
            "run_pipeline_from_crop",
            lambda crop_bgr, face_count, face_index: _fake_pipeline_result(
                crop_bgr, face_count, face_index
            ),
        )
        with open(ONE_FACE_IMAGE, "rb") as f:
            detected = client.post("/detect", files={"file": ("test.png", f, "image/png")})
        token = detected.json()["token"]

        first = client.post("/analyze", data={"token": token, "face_index": 0})
        second = client.post("/analyze", data={"token": token, "face_index": 0})

        assert first.status_code == 200
        assert second.status_code == 404


class TestRecommendedFaceIndex:
    """
    Which Face Candidate runs when nobody chooses.

    Kept next to the API tests because the rule is what the picker and the
    no-picker path have to agree on: the frontend writes it a second time in
    lib/faces.js, and the two are kept honest by asserting the same cases on
    both sides rather than by shipping the answer over the wire.
    """

    def test_prefers_the_largest_face_over_the_leftmost(self):
        faces = [
            {"bbox": [0, 0, 40, 40], "det_score": 0.9},
            {"bbox": [100, 0, 400, 380], "det_score": 0.9},
            {"bbox": [500, 0, 560, 60], "det_score": 0.9},
        ]
        assert recommended_face_index(faces) == 1

    def test_compares_area_not_either_dimension_alone(self):
        faces = [
            {"bbox": [0, 0, 400, 20], "det_score": 0.9},   # widest
            {"bbox": [0, 0, 100, 100], "det_score": 0.9},  # largest by area
        ]
        assert recommended_face_index(faces) == 1

    def test_breaks_an_area_tie_on_det_score(self):
        # The bug this guards: expressed as `area == max(area)` the answer was
        # a set, not a face, and two equally-sized faces both belonged to it.
        faces = [
            {"bbox": [0, 0, 200, 200], "det_score": 0.71},
            {"bbox": [300, 0, 500, 200], "det_score": 0.94},
            {"bbox": [600, 0, 800, 200], "det_score": 0.83},
        ]
        assert recommended_face_index(faces) == 1

    def test_a_single_face_is_its_own_answer(self):
        assert recommended_face_index([{"bbox": [0, 0, 10, 10], "det_score": 0.9}]) == 0

    @requires_sample_image
    def test_detect_face_uses_it(self, monkeypatch):
        """detect_face() is the no-picker path the evaluation scripts take. It
        took faces[0] until this change, so it disagreed with the picker's
        recommendation on every photo where leftmost and largest differ."""
        seen = {}

        def fake_detect_all(path):
            faces = [
                {"bbox": [0, 0, 40, 40], "det_score": 0.9},
                {"bbox": [100, 0, 400, 380], "det_score": 0.9},
            ]
            return np.full((400, 500, 3), 128, dtype=np.uint8), faces

        monkeypatch.setattr(face_pipeline, "detect_all_faces", fake_detect_all)
        monkeypatch.setattr(
            face_pipeline,
            "crop_face_from_bbox",
            lambda img, bbox: seen.setdefault("bbox", bbox) or np.zeros((224, 224, 3)),
        )

        _crop, count, index = face_pipeline.detect_face("ignored.png")

        assert count == 2
        assert index == 1
        assert seen["bbox"] == [100, 0, 400, 380]
