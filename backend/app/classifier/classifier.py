import os
import timm
import torch
import numpy as np
from torchvision import transforms
from PIL import Image

CHECKPOINT = os.path.join(os.path.dirname(__file__),
                          "../../models/effnb4_deepfake.pt")

_model = None

tfm = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225]),
])


def _load_model():
    global _model
    if _model is not None:
        return _model

    m = timm.create_model("efficientnet_b4", pretrained=True, num_classes=2)
    ckpt = os.path.normpath(CHECKPOINT)
    if os.path.exists(ckpt):
        state = torch.load(ckpt, map_location="cpu")
        m.load_state_dict(state)
        print(f"[classifier] loaded checkpoint: {ckpt}")
    else:
        print("[classifier] no checkpoint found — using ImageNet pretrained weights")

    m.eval()
    if torch.cuda.is_available():
        m = m.cuda()
    _model = m
    return _model


def classify(face_crop_bgr: np.ndarray) -> dict:
    """
    face_crop_bgr: HxWx3 BGR uint8 numpy array (output of face_pipeline).
    Returns {"fake_score": float, "real_score": float}.
    Labels: class 0 = real, class 1 = fake  (matches training convention).
    """
    model = _load_model()
    rgb = face_crop_bgr[:, :, ::-1].copy()
    pil = Image.fromarray(rgb.astype(np.uint8))
    x = tfm(pil).unsqueeze(0)
    if next(model.parameters()).is_cuda:
        x = x.cuda()
    with torch.no_grad():
        probs = torch.softmax(model(x), dim=1)[0]
    return {
        "fake_score": float(probs[1]),
        "real_score": float(probs[0]),
    }


if __name__ == "__main__":
    import sys
    import cv2
    from backend.app.preprocessing.face_pipeline import get_face_crop

    img_path = sys.argv[1] if len(sys.argv) > 1 else None
    if img_path is None:
        print("Usage: python -m backend.app.classifier.classifier <image_path>")
        sys.exit(1)

    crop = get_face_crop(img_path)
    if crop is None:
        print("No face detected.")
        sys.exit(1)

    result = classify(crop)
    print(f"fake_score: {result['fake_score']:.4f}")
    print(f"real_score: {result['real_score']:.4f}")
    verdict = "FAKE" if result["fake_score"] > 0.5 else "REAL"
    print(f"verdict:    {verdict}")
