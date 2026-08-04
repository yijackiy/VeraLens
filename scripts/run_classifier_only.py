"""
Step 1.4 — End-to-end: face crop → EfficientNet-B4 classifier score.

Usage:
    python scripts/run_classifier_only.py <image_path>
    python scripts/run_classifier_only.py  # uses a default test image
"""

import sys
import os

# Allow running from the veralens/ root with `python scripts/...`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.preprocessing.face_pipeline import get_face_crop
from backend.app.classifier.classifier import classify

DEFAULT_IMAGE = "data/deepfake_faces/fake/test_000 (1).png"


def run(image_path: str):
    print(f"Image : {image_path}")

    crop = get_face_crop(image_path)
    if crop is None:
        print("Result: no face detected — cannot classify")
        return

    print(f"Crop  : {crop.shape}")

    result = classify(crop)
    print(f"fake_score : {result['fake_score']:.4f}")
    print(f"real_score : {result['real_score']:.4f}")
    verdict = "FAKE" if result["fake_score"] > 0.5 else "REAL"
    conf = max(result["fake_score"], result["real_score"])
    print(f"Verdict    : {verdict}  ({conf*100:.1f}% confidence)")
    return result


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IMAGE
    run(path)
