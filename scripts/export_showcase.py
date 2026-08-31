"""
Static showcase export — builds the data behind showcase/index.html.

Runs the VeraLens pipeline over a chosen set of images and writes:

    showcase/data/results.json        one record per image
    showcase/data/img/<id>_crop.png   the 224x224 face crop that was analysed
    showcase/data/img/<id>_cam.png    the Grad-CAM overlay

Deliberately two passes, not one per image: every classifier + Grad-CAM call
runs first, the classifier is then unloaded, and Qwen3-VL is loaded once for
all the explanations. pipeline.py's per-image order reloads EfficientNet while
Qwen is still resident on the GPU — harmless for a single request, a slow OOM
risk across thirty of them, and it would reload a 2B model every image.

Each record keeps the classifier score, the LLM verdict and the fused result
separately, so this same file also feeds the Step 4.2 ablation table.

Usage:
    python scripts/export_showcase.py path/to/img1.png path/to/img2.jpg
    python scripts/export_showcase.py --from-dataset 8
    python scripts/export_showcase.py --from-dataset 8 --seed 7

PUBLISHING NOTE: the "real" class contains photographs of actual people and the
dataset is CC BY-NC 4.0. Think about which images belong on a public URL before
you deploy — see showcase/README.md.
"""

import argparse
import datetime as dt
import json
import os
import random
import sys
import time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.preprocessing.face_pipeline import get_face_crop
from backend.app.classifier.classifier import classify, unload_model, CHECKPOINT
from backend.app.classifier.gradcam import get_heatmap, unload_cam
from backend.app.llm.model import MODEL_ID
from backend.app.llm.reasoner import run_reasoning
from backend.app.fusion.fusion import fuse

OUT_DIR = os.path.join("showcase", "data")
IMG_DIR = os.path.join(OUT_DIR, "img")
DATASET_DIR = os.path.join("data", "deepfake_faces")

W_VISION, W_LLM = 0.55, 0.45


def infer_label(path: str):
    """dataset folder name, when the image came from data/deepfake_faces/."""
    parts = os.path.normpath(path).replace("\\", "/").split("/")
    for name in ("fake", "real"):
        if name in parts:
            return name
    return None


def sample_from_dataset(n_per_class: int, seed: int):
    rng = random.Random(seed)
    picked = []
    for label in ("fake", "real"):
        folder = os.path.join(DATASET_DIR, label)
        if not os.path.isdir(folder):
            print(f"[showcase] {folder} not found — skipping {label}")
            continue
        files = [f for f in os.listdir(folder)
                 if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
        for f in rng.sample(files, min(n_per_class, len(files))):
            picked.append(os.path.join(folder, f))
    return picked


def gpu_name():
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        pass
    return "CPU"


def main():
    ap = argparse.ArgumentParser(description="Export static showcase data.")
    ap.add_argument("images", nargs="*", help="image paths to analyse")
    ap.add_argument("--from-dataset", type=int, metavar="N",
                    help="also sample N images from each dataset class")
    ap.add_argument("--seed", type=int, default=42, help="sampling seed")
    ap.add_argument("--out", default=OUT_DIR, help="output directory")
    args = ap.parse_args()

    out_dir = args.out
    img_dir = os.path.join(out_dir, "img")
    os.makedirs(img_dir, exist_ok=True)

    paths = list(args.images)
    if args.from_dataset:
        paths += sample_from_dataset(args.from_dataset, args.seed)
    if not paths:
        ap.error("give image paths, or --from-dataset N, or both")

    print(f"[showcase] {len(paths)} image(s) queued")
    print(f"[showcase] device: {gpu_name()}")

    # ---- pass 1: face crop + classifier + Grad-CAM -------------------------
    staged = []
    for i, path in enumerate(paths, start=1):
        sample_id = f"s{i:03d}"
        print(f"[showcase] ({i}/{len(paths)}) vision  {os.path.basename(path)}")

        t0 = time.perf_counter()
        crop = get_face_crop(path)
        if crop is None:
            print("           no face detected — skipped")
            continue
        t_face = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        scores = classify(crop)
        t_cls = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        cam = get_heatmap(crop)
        t_cam = (time.perf_counter() - t0) * 1000

        cv2.imwrite(os.path.join(img_dir, f"{sample_id}_crop.png"), crop)
        cv2.imwrite(os.path.join(img_dir, f"{sample_id}_cam.png"), cam[:, :, ::-1])

        staged.append({
            "id": sample_id,
            "source_file": os.path.basename(path),
            "source_label": infer_label(path),
            "crop_url": f"data/img/{sample_id}_crop.png",
            "heatmap_url": f"data/img/{sample_id}_cam.png",
            "classifier": {
                "fake_score": round(scores["fake_score"], 4),
                "real_score": round(scores["real_score"], 4),
                "verdict": "fake" if scores["fake_score"] > 0.5 else "real",
            },
            "timings_ms": {"face": round(t_face), "classifier": round(t_cls),
                           "gradcam": round(t_cam)},
            "_crop": crop,
        })

    # Free the GPU before the VLM is loaded — the sequential-loading rule.
    unload_cam()
    unload_model()
    print("[showcase] classifier unloaded, loading Qwen3-VL once")

    # ---- pass 2: one VLM load, every explanation ---------------------------
    samples = []
    for i, rec in enumerate(staged, start=1):
        print(f"[showcase] ({i}/{len(staged)}) reason  {rec['source_file']}")
        crop = rec.pop("_crop")
        crop_pil = Image.fromarray(crop[:, :, ::-1])

        t0 = time.perf_counter()
        llm = run_reasoning(crop_pil, rec["classifier"]["fake_score"])
        rec["timings_ms"]["llm"] = round((time.perf_counter() - t0) * 1000)
        rec["timings_ms"]["total"] = sum(rec["timings_ms"].values())

        fused = fuse(rec["classifier"]["fake_score"], llm, W_VISION, W_LLM)
        rec["llm"] = {
            "verdict": llm.get("verdict"),
            "confidence": llm.get("confidence"),
            "signals": llm.get("signals", []),
            "explanation": llm.get("explanation", ""),
            "parsed_ok": llm.get("verdict") != "unknown",
        }
        rec["fused"] = {
            "verdict": fused["final_verdict"],
            "confidence": round(fused["final_confidence"], 4),
        }
        rec["correct"] = (rec["source_label"] == fused["final_verdict"]
                          if rec["source_label"] else None)
        samples.append(rec)

    scored = [s for s in samples if s["correct"] is not None]
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc)
                          .strftime("%Y-%m-%d %H:%M UTC"),
        "hardware": gpu_name(),
        "pipeline": {
            "face": "InsightFace buffalo_l",
            "classifier": "EfficientNet-B4 (timm), fine-tuned on DF40",
            "checkpoint": os.path.basename(os.path.normpath(CHECKPOINT)),
            "vlm": MODEL_ID + " (4-bit)",
            "fusion": {"w_vision": W_VISION, "w_llm": W_LLM},
        },
        "summary": {
            "n": len(samples),
            "n_labelled": len(scored),
            "n_correct": sum(1 for s in scored if s["correct"]),
            "llm_parse_failures": sum(1 for s in samples
                                      if not s["llm"]["parsed_ok"]),
            "median_total_ms": int(np.median([s["timings_ms"]["total"]
                                              for s in samples])) if samples else None,
        },
        "samples": samples,
    }

    out_file = os.path.join(out_dir, "results.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    s = payload["summary"]
    print(f"\n[showcase] wrote {out_file}")
    print(f"[showcase] {s['n']} samples, {s['n_correct']}/{s['n_labelled']} correct, "
          f"{s['llm_parse_failures']} LLM parse failure(s), "
          f"median {s['median_total_ms']} ms/image")
    print("[showcase] preview:  python -m http.server -d showcase 8080")


if __name__ == "__main__":
    main()
