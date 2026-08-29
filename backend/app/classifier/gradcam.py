import numpy as np
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.image import show_cam_on_image
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget
from PIL import Image

from backend.app.classifier.classifier import _load_model, tfm

FAKE_CLASS_IDX = 1  # matches classifier.py's training convention

_cam = None


def _get_cam():
    global _cam
    if _cam is None:
        model = _load_model()
        target_layers = [model.conv_head]  # last conv layer of EfficientNet-B4
        _cam = GradCAM(model=model, target_layers=target_layers)
    return _cam


def unload_cam():
    """Releases the CAM's hooks on the classifier before it is unloaded."""
    global _cam
    if _cam is not None:
        _cam.activations_and_grads.release()
        _cam = None


def get_heatmap(face_crop_bgr: np.ndarray) -> np.ndarray:
    """
    face_crop_bgr: HxWx3 BGR uint8 numpy array (same input as classifier.classify()).
    Returns an HxWx3 RGB uint8 image with the Grad-CAM heatmap overlaid on the
    original crop, targeted at the "fake" class so warm regions indicate what
    pushed the model toward a fake verdict.
    """
    cam = _get_cam()
    model = _load_model()

    rgb_uint8 = face_crop_bgr[:, :, ::-1].copy()
    rgb_float = rgb_uint8.astype(np.float32) / 255.0

    pil = Image.fromarray(rgb_uint8)
    input_tensor = tfm(pil).unsqueeze(0)
    if next(model.parameters()).is_cuda:
        input_tensor = input_tensor.cuda()

    grayscale_cam = cam(
        input_tensor=input_tensor,
        targets=[ClassifierOutputTarget(FAKE_CLASS_IDX)],
    )[0]
    return show_cam_on_image(rgb_float, grayscale_cam, use_rgb=True)


if __name__ == "__main__":
    import sys
    import cv2
    from backend.app.preprocessing.face_pipeline import get_face_crop

    img_path = sys.argv[1] if len(sys.argv) > 1 else None
    if img_path is None:
        print("Usage: python -m backend.app.classifier.gradcam <image_path>")
        sys.exit(1)

    crop = get_face_crop(img_path)
    if crop is None:
        print("No face detected.")
        sys.exit(1)

    overlay = get_heatmap(crop)
    out_path = "gradcam_output.png"
    cv2.imwrite(out_path, overlay[:, :, ::-1])  # RGB -> BGR for cv2.imwrite
    print(f"Heatmap saved to {out_path}")
