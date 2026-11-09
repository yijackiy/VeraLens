import os
import shutil
import tempfile
import threading
import time
import uuid

import logging

import cv2
from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app import progress
from backend.app.pipeline import run_pipeline_from_crop, STATIC_DIR
from backend.app.preprocessing.face_pipeline import crop_face_from_bbox, detect_all_faces

log = logging.getLogger("veralens.api")

# VERALENS_PUBLIC=1 when the app is reachable from outside this machine (the
# Cloudflare Tunnel deployment, see DEPLOY.md). It only switches off the
# interactive API docs, which a visitor has no use for and which advertise
# every endpoint to anyone who finds the URL.
PUBLIC = os.getenv("VERALENS_PUBLIC") == "1"

# Analyses allowed to be running or waiting for the GPU at once. One runs and
# the rest queue behind _gpu_lock, a minute each at the median, so past this
# a new photo would wait longer than anyone stays on the page. Refusing it
# up front is kinder than accepting it and never answering.
MAX_ACTIVE_ANALYSES = int(os.getenv("VERALENS_MAX_ACTIVE", "4"))

# A Submitted Photo larger than this is refused before it is written to disk.
MAX_UPLOAD_BYTES = int(os.getenv("VERALENS_MAX_UPLOAD_MB", "20")) * 1024 * 1024

# How long an upload waits for its /analyze, and how long a finished result
# waits to be collected, before they are swept. Long enough for a slow picker
# or a slow poll; short enough that abandoned uploads cannot pile up on a
# machine open to the internet.
PENDING_TTL_SECONDS = 15 * 60
RESULT_TTL_SECONDS = 10 * 60

app = FastAPI(
    title="VeraLens API",
    docs_url=None if PUBLIC else "/docs",
    redoc_url=None if PUBLIC else "/redoc",
    openapi_url=None if PUBLIC else "/openapi.json",
)
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
# In-memory and single-process, matching _gpu_lock above, so the server must
# run as one uvicorn worker. A lost token on restart is an accepted gap.
# Abandoned uploads are swept after PENDING_TTL_SECONDS (_sweep below) now
# that the app can be reached from the internet.
_pending: dict[str, tuple[str, list[dict], float]] = {}

# An Analysis by its token, from the moment /analyze accepts it until its
# result is collected or expires (ADR 0016):
#   {"status": "running"}
#   {"status": "done",   "result": {...}, "finished": t}
#   {"status": "failed", "detail": "...", "finished": t}
# /analyze answers at once and the pipeline runs on its own thread, because a
# request held open for the whole Analysis is cut off at 100 s by Cloudflare's
# proxy (error 524) and 36% of measured Analyses take longer than 90 s.
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _sweep() -> None:
    """Forget uploads nobody analysed and results nobody collected."""
    now = time.monotonic()
    for token, (path, _faces, created) in list(_pending.items()):
        if now - created > PENDING_TTL_SECONDS:
            _pending.pop(token, None)
            if os.path.exists(path):
                os.remove(path)
    with _jobs_lock:
        for token, job in list(_jobs.items()):
            finished = job.get("finished")
            if finished is not None and now - finished > RESULT_TTL_SECONDS:
                _jobs.pop(token, None)


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
    _sweep()
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"The photo is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    suffix = os.path.splitext(file.filename or "")[1]
    token = str(uuid.uuid4())
    path = os.path.join(tempfile.gettempdir(), f"{token}{suffix}")
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    img, faces = detect_all_faces(path)
    if img is None or not faces:
        os.remove(path)
        return {"faces": []}

    _pending[token] = (path, faces, time.monotonic())
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


def _run_analysis(token: str, path: str, faces: list[dict], face_index: int) -> None:
    """The slow half of the pipeline, on a thread of its own. Whatever happens,
    the upload is deleted and the job ends in "done" or "failed"; it never
    stays "running" after this returns."""
    try:
        # Tracked from before the lock, not inside it: an Analysis waiting its
        # turn behind another is a stage the interface can show, and it is the
        # one a second photo spends its first minute in. progress.track() sets
        # a ContextVar, so it has to run on this thread, not the request's.
        with progress.track(token):
            img = cv2.imread(path)
            crop = crop_face_from_bbox(img, faces[face_index]["bbox"])
            with _gpu_lock:
                result = run_pipeline_from_crop(crop, len(faces), face_index)
        outcome = {"status": "done", "result": result}
    except Exception:
        log.exception("Analysis %s failed", token)
        outcome = {"status": "failed", "detail": "The analysis failed on the server."}
    finally:
        if os.path.exists(path):
            os.remove(path)
    with _jobs_lock:
        _jobs[token] = {**outcome, "finished": time.monotonic()}


@app.post("/analyze", status_code=202)
def analyze(token: str = Form(...), face_index: int = Form(...)):
    """
    Step 2 of 2. Takes what /detect returned — the token and which face was
    chosen — and starts the slow half of the pipeline on that one face.

    Answers 202 at once; the Analysis itself runs on a background thread and
    its result is collected from GET /result/{token} (ADR 0016). Before this,
    the request stayed open for the whole Analysis — a minute at the median,
    nearer three at p90 — which a proxy with a 100 s limit cuts off.

    A bad token or face index is still answered here, synchronously, so the
    interface learns about it from this request rather than from a poll.
    """
    _sweep()
    with _jobs_lock:
        active = sum(1 for job in _jobs.values() if job["status"] == "running")
    if active >= MAX_ACTIVE_ANALYSES:
        raise HTTPException(
            status_code=429,
            detail="VeraLens is busy with other photos. Please try again in a few minutes.",
        )

    pending = _pending.pop(token, None)
    if pending is None:
        raise HTTPException(status_code=404, detail="Unknown or already-used upload token.")
    path, faces, _created = pending
    if not 0 <= face_index < len(faces):
        os.remove(path)
        raise HTTPException(status_code=400, detail="face_index is out of range.")

    with _jobs_lock:
        _jobs[token] = {"status": "running"}
    threading.Thread(
        target=_run_analysis,
        args=(token, path, faces, face_index),
        name=f"analysis-{token[:8]}",
        daemon=True,
    ).start()
    return {"token": token, "status": "running"}


@app.get("/result/{token}")
def analysis_result(token: str):
    """
    The outcome of the Analysis started for this token.

    202 while it is still running (ask /progress for the stage), 200 with the
    result once done, 500 if the pipeline raised, 404 for a token that never
    started or whose result expired. A finished result can be read more than
    once until it expires, so a poll whose response is lost in transit does
    not lose the Analysis with it.
    """
    with _jobs_lock:
        job = _jobs.get(token)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown or expired analysis.")
    if job["status"] == "running":
        return JSONResponse(status_code=202, content={"status": "running"})
    if job["status"] == "failed":
        raise HTTPException(status_code=500, detail=job["detail"])
    return job["result"]


@app.get("/progress/{token}")
def analysis_progress(token: str):
    """
    Where the Analysis for this token has got to — see progress.py, and ADR
    0015 for why this is a stage and never a percentage.

    A plain `def` for the same reason as /analyze: it is answered from the
    threadpool, so it stays responsive while a pipeline holds the GPU, which is
    the only time anyone asks. Unknown tokens answer 200 with no stage rather
    than 404 — the interface's first ask can arrive before /analyze has
    registered the token, and that is a healthy start, not an error.
    """
    return progress.snapshot(token) or {"stage": None}


# The built frontend (npm run build), served from this same origin when it
# exists: one server, one URL, no CORS and no second process for the tunnel to
# reach. Mounted last so it never shadows an API route. In development the
# Vite dev server serves the frontend instead and this directory may be stale
# or absent, which is fine.
FRONTEND_DIST = os.getenv(
    "VERALENS_FRONTEND_DIST",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "dist"),
)
if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
