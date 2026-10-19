import os
import shutil
import tempfile
import threading
import uuid

import cv2
from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app.pipeline import run_pipeline_from_crop, STATIC_DIR
from backend.app.preprocessing.face_pipeline import crop_face_from_bbox, detect_all_faces

app = FastAPI(title="VeraLens API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# One GPU, one pipeline at a time. classifier.py, gradcam.py and model.py each
# keep the loaded model in a module-level global, and run_pipeline_from_crop()
# frees the classifier partway through — so two overlapping analyses can
# unload a model out from under the request still using it. Serialising here
# is not a throttle, it matches the hardware.
_gpu_lock = threading.Lock()

# Bridges /detect and /analyze. Detection is a fast, separate first request
# (the multi-face picker needs the box list before anything is classified),
# so the upload has to survive until the browser says which face it wants:
# token -> (temp file path, the face list detection already found).
# In-memory and single-process, matching _gpu_lock above — this is a
# one-user local demo, not a hosted multi-tenant service, so a lost token on
# restart or an abandoned upload never getting cleaned up is an accepted gap,
# the same shape as the un-swept heatmap directory below it.
_pending: dict[str, tuple[str, list[dict]]] = {}


@app.get("/health")
def health():
    """
    Step 4.5 — cheap liveness probe for the keep-alive cron.

    Deliberately dependency-free: no model load, no DB round-trip. Free-tier
    hosts spin down after ~15 min idle and take ~1 min to wake, so a ping every
    10 minutes keeps the demo from opening on a loading screen. A handler that
    touched the pipeline would defeat the point.
    """
    return {"status": "ok"}


@app.post("/detect")
def detect(file: UploadFile = File(...)):
    """
    Step 1 of 2. Detection alone is ~0.2s on this hardware's default CPU
    config (ADR 0011) — cheap enough to run outside _gpu_lock and answer
    before anything is classified. The browser then knows how many faces
    there are and, when more than one, gets to choose before /analyze starts
    the slow half of the pipeline.

    {"faces": []} for zero faces (matches /analyze's old no_face_detected
    contract, just found one request earlier); otherwise a token plus one
    entry per face, sorted left to right.
    """
    suffix = os.path.splitext(file.filename)[1]
    token = str(uuid.uuid4())
    path = os.path.join(tempfile.gettempdir(), f"{token}{suffix}")
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    img, faces = detect_all_faces(path)
    if img is None or not faces:
        os.remove(path)
        return {"faces": []}

    _pending[token] = (path, faces)
    return {
        "token": token,
        "faces": [
            {
                "index": i,
                "bbox": f["bbox"],
                "det_score": f["det_score"],
                "width": f["bbox"][2] - f["bbox"][0],
                "height": f["bbox"][3] - f["bbox"][1],
            }
            for i, f in enumerate(faces)
        ],
    }


@app.post("/analyze")
def analyze(token: str = Form(...), face_index: int = Form(...)):
    """
    Step 2 of 2. Takes what /detect returned — the token and which face was
    chosen — and runs the slow half of the pipeline on that one face.

    Deliberately `def`, not `async def`.

    run_pipeline_from_crop() blocks for a minute at the median and
    nearer three at p90. On an async endpoint
    that runs directly on the event loop, so nothing else is served for the
    whole analysis — including /health, which exists to be polled every 10
    minutes and would time out exactly when the server is busiest. A plain
    `def` endpoint is handed to Starlette's threadpool instead, leaving the
    loop free, and _gpu_lock keeps the pipeline itself single-file.
    """
    pending = _pending.pop(token, None)
    if pending is None:
        raise HTTPException(status_code=404, detail="Unknown or already-used upload token.")
    path, faces = pending
    if not 0 <= face_index < len(faces):
        os.remove(path)
        raise HTTPException(status_code=400, detail="face_index is out of range.")

    try:
        img = cv2.imread(path)
        crop = crop_face_from_bbox(img, faces[face_index]["bbox"])
        with _gpu_lock:
            result = run_pipeline_from_crop(crop, len(faces), face_index)
    finally:
        os.remove(path)
    return result
