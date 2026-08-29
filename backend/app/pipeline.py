import os
import uuid

import cv2
from PIL import Image

from backend.app.preprocessing.face_pipeline import get_face_crop
from backend.app.classifier.classifier import classify, unload_model
from backend.app.classifier.gradcam import get_heatmap, unload_cam
from backend.app.llm.reasoner import run_reasoning
from backend.app.fusion.fusion import fuse

APP_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.normpath(os.path.join(APP_DIR, "..", "static"))
HEATMAP_DIR = os.path.join(STATIC_DIR, "heatmaps")


def run_full_pipeline(image_path: str) -> dict:
    """
    End-to-end: face crop -> classifier + Grad-CAM -> free classifier VRAM ->
    Qwen3-VL reasoning -> fusion. Follows the Week 2 sequential-loading
    pattern so the classifier and the LLM are never resident on the GPU
    at the same time.
    """
    crop_bgr = get_face_crop(image_path)
    if crop_bgr is None:
        return {"error": "no_face_detected"}

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
    return result
