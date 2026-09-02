import cv2
from insightface.app import FaceAnalysis

app = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider"])
app.prepare(ctx_id=0, det_size=(640, 640))

def detect_face(image_path: str):
    """
    Returns (crop, face_count): the 224x224 Face Crop of the first detection,
    or (None, 0) when nothing was found.

    The count is reported alongside the crop because "no face" and "three
    faces, we analysed one" are different situations for whoever submitted the
    photo, and the interface words them differently. Only the first face is
    ever analysed — that is unchanged.
    """
    img = cv2.imread(image_path)
    if img is None:
        return None, 0
    faces = app.get(img)
    if not faces:
        return None, 0
    x1, y1, x2, y2 = faces[0].bbox.astype(int)
    crop = img[max(0, y1):y2, max(0, x1):x2]
    return cv2.resize(crop, (224, 224)), len(faces)


def get_face_crop(image_path: str):
    """Crop only. Kept as-is for the evaluation scripts, which never need the count."""
    crop, _ = detect_face(image_path)
    return crop
