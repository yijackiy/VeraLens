import cv2
from insightface.app import FaceAnalysis

app = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider"])
app.prepare(ctx_id=0, det_size=(640, 640))

def get_face_crop(image_path: str):
    img = cv2.imread(image_path)
    if img is None:
        return None
    faces = app.get(img)
    if not faces:
        return None
    x1, y1, x2, y2 = faces[0].bbox.astype(int)
    crop = img[max(0, y1):y2, max(0, x1):x2]
    return cv2.resize(crop, (224, 224))
