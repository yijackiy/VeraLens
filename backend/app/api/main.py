import os
import shutil
import tempfile
import uuid

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app.pipeline import run_full_pipeline, STATIC_DIR

app = FastAPI(title="VeraLens API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[1]
    path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}{suffix}")
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        result = run_full_pipeline(path)
    finally:
        os.remove(path)
    return result
