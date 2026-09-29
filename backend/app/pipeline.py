import os
import time
import uuid

import cv2
from PIL import Image

from backend.app.preprocessing.face_pipeline import detect_face
from backend.app.classifier.classifier import classify, unload_model
from backend.app.classifier.gradcam import get_heatmap, unload_cam
from backend.app.llm.reasoner import run_reasoning
from backend.app.fusion.fusion import fuse

APP_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.normpath(os.path.join(APP_DIR, "..", "static"))
HEATMAP_DIR = os.path.join(STATIC_DIR, "heatmaps")


def run_pipeline_from_crop(crop_bgr, face_count: int) -> dict:
    """
    The half of the pipeline that runs once a Face Crop has been chosen:
    classifier + Grad-CAM -> free classifier VRAM -> Qwen3-VL reasoning ->
    fusion. Follows the Week 2 sequential-loading pattern so the classifier
    and the LLM are never resident on the GPU at the same time.

    Split out of run_full_pipeline() so the /detect + /analyze API route can
    run detection once, let the browser choose a face, and start this half
    only for the one that was chosen — a caller that already has a crop
    should not pay for a second detection pass.
    """
    started = time.perf_counter()

    classifier_result = classify(crop_bgr)
    heatmap = get_heatmap(crop_bgr)

    os.makedirs(HEATMAP_DIR, exist_ok=True)
    heatmap_filename = f"{uuid.uuid4()}.png"
    cv2.imwrite(os.path.join(HEATMAP_DIR, heatmap_filename), heatmap[:, :, ::-1])  # RGB -> BGR

    unload_cam()
    unload_model()

    crop_pil = Image.fromarray(crop_bgr[:, :, ::-1])  # BGR -> RGB
    llm_result = run_reasoning(crop_pil, classifier_result["fake_score"])

    result = fuse(classifier_result["fake_score"], llm_result)
    result["heatmap_url"] = f"/static/heatmaps/{heatmap_filename}"
    result["faces_found"] = face_count
    # Measured, not estimated. The interface cannot report progress while the
    # pipeline runs (one blocking response), so the honest thing it can show
    # afterwards is how long this particular photo actually took.
    result["elapsed_seconds"] = round(time.perf_counter() - started, 1)
    return result


def run_full_pipeline(image_path: str) -> dict:
    """
    End-to-end from a raw image path: detects the leftmost face and runs
    run_pipeline_from_crop() on it. Used by the evaluation scripts, which have
    no picker and always want "the" face in one call; the live API calls
    face_pipeline.detect_all_faces() and run_pipeline_from_crop() separately
    instead, so a face chosen in the browser can come from a second request.
    """
    crop_bgr, face_count = detect_face(image_path)
    if crop_bgr is None:
        return {"error": "no_face_detected"}
    return run_pipeline_from_crop(crop_bgr, face_count)
