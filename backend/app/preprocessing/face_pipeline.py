"""
Face detection and cropping.

The ONNX Runtime execution provider is chosen here, and the choice is not the
obvious one — see ADR 0011. Short version: detection is 0.23s on CPU and 0.05s
on CUDA, and CUDA costs 805 MiB of a 4096 MiB card, permanently, because this
module holds its FaceAnalysis for the life of the process. On this hardware the
0.2 seconds are not worth a fifth of the VRAM budget, so CPU is the default and
VERALENS_FACE_DEVICE=cuda opts in.
"""

import os

import cv2

# Must happen before insightface imports onnxruntime. The CUDA execution
# provider is a separate DLL that pulls in cuBLAS and cuDNN, and it resolves
# those through the normal Windows search path — os.add_dll_directory does not
# reach a transitive dependency loaded this way, so PATH is the lever that
# works. torch ships the matching CUDA 12 runtime, which is why nothing here
# needs a system CUDA toolkit installed.
def _add_torch_libs_to_path() -> None:
    try:
        import torch
    except ImportError:
        return
    lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.isdir(lib) and lib not in os.environ.get("PATH", ""):
        os.environ["PATH"] = lib + os.pathsep + os.environ.get("PATH", "")


FACE_DEVICE = (os.environ.get("VERALENS_FACE_DEVICE") or "cpu").strip().lower()
_USE_CUDA = FACE_DEVICE == "cuda"

if _USE_CUDA:
    _add_torch_libs_to_path()

from insightface.app import FaceAnalysis  # noqa: E402  (must follow the PATH edit)

_providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if _USE_CUDA else ["CPUExecutionProvider"]

app = FaceAnalysis(name="buffalo_l", providers=_providers)
app.prepare(ctx_id=0 if _USE_CUDA else -1, det_size=(640, 640))

# What was asked for and what was granted are different questions: ONNX Runtime
# falls back to CPU silently when the CUDA provider cannot load, and this module
# asked for CUDA for months while running on CPU with nothing but a warning
# buried in the startup log. Print the answer, not the request.
_applied = app.models["detection"].session.get_providers() if app.models.get("detection") else []
print(f"[face] VERALENS_FACE_DEVICE={FACE_DEVICE} -> providers in use: {_applied}")
if _USE_CUDA and "CUDAExecutionProvider" not in _applied:
    print("[face] WARNING: CUDA was requested but ONNX Runtime fell back to CPU. "
          "Check that onnxruntime-gpu matches torch's CUDA major version.")


def crop_face_from_bbox(img, bbox):
    """The 224x224 Face Crop for one bbox out of an image already read by cv2."""
    x1, y1, x2, y2 = bbox
    crop = img[max(0, y1):y2, max(0, x1):x2]
    return cv2.resize(crop, (224, 224))


def detect_all_faces(image_path: str):
    """
    Returns (img, faces): the cv2-decoded image and one dict per detection —
    {"bbox": [x1, y1, x2, y2], "det_score": float} — sorted left to right so
    the picker's reading order matches the photo. (None, []) when the file
    could not be decoded or nothing was found.

    img is returned alongside the boxes so a caller that goes on to crop a
    chosen face (the multi-face picker's second request) does not decode the
    file a second time.
    """
    img = cv2.imread(image_path)
    if img is None:
        return None, []
    faces = app.get(img)
    boxes = [
        {"bbox": [int(v) for v in f.bbox.astype(int)], "det_score": float(f.det_score)}
        for f in faces
    ]
    boxes.sort(key=lambda f: f["bbox"][0])
    return img, boxes


def detect_face(image_path: str):
    """
    Returns (crop, face_count): the 224x224 Face Crop of the leftmost
    detection, or (None, 0) when nothing was found.

    The count is reported alongside the crop because "no face" and "three
    faces, we analysed one" are different situations for whoever submitted the
    photo, and the interface words them differently. Kept for the evaluation
    scripts, which have no picker and always want "the" face; the live API
    calls detect_all_faces() and crop_face_from_bbox() separately instead, so
    a chosen face can come from a second request.
    """
    img, faces = detect_all_faces(image_path)
    if img is None or not faces:
        return None, 0
    return crop_face_from_bbox(img, faces[0]["bbox"]), len(faces)


def get_face_crop(image_path: str):
    """Crop only. Kept as-is for the evaluation scripts, which never need the count."""
    crop, _ = detect_face(image_path)
    return crop
