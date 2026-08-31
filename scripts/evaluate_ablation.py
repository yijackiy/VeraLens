"""
Three-arm ablation: Vision-Only vs LLM-Only vs Fused (build guide step 4.2).

Isolates how much the Qwen3-VL reasoning layer actually contributes to
detection, over and above the EfficientNet-B4 classifier alone.

Arms
----
Vision-Only  the classifier's fake probability, thresholded at 0.5
LLM-Only     Qwen3-VL's own verdict, from the image alone
Fused        both, combined by backend.app.fusion.fuse()

The reasoning layer runs BLIND here. Production hands the VLM the classifier's
score, which is right for explanation (the text should account for the score),
but an LLM-Only arm that can read the classifier's answer is not LLM-only, and
fusing it would double-count a single signal. See run_reasoning(fake_score=None).

Sampling
--------
A stratified sample of the recovered Validation Split (see evaluate.py), 50/50
real/fake, then shuffled, so any prefix of the run is itself a valid unbiased
sample. Results are appended per image, so an interrupted or crashed run keeps
everything finished so far and re-running resumes where it stopped.

VRAM: the classifier scores every image first and is fully unloaded before
Qwen3-VL loads. The two models are never resident together (4GB budget).

Usage:
    python scripts/evaluate_ablation.py                # 800 images
    python scripts/evaluate_ablation.py --n 20         # quick smoke test
    python scripts/evaluate_ablation.py --restart      # discard and start over
"""

import argparse
import json
import os
import random
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

import numpy as np
import torch
from PIL import Image

from evaluate import (
    CLASS_NAMES,
    IMG_SIZE,
    RESULTS_DIR,
    compute_metrics,
    leaked_keys,
    recover_splits,
)

ABLATION_SEED = 1337
RECORDS_PATH = os.path.join(RESULTS_DIR, "ablation_records.jsonl")
METRICS_PATH = os.path.join(RESULTS_DIR, "ablation_metrics.json")
INFORMED_RECORDS = os.path.join(RESULTS_DIR, "ablation_records_informed.jsonl")
INFORMED_METRICS = os.path.join(RESULTS_DIR, "ablation_metrics_informed.json")
DEFAULT_N = 800


def stratified_sample(samples, n, seed=ABLATION_SEED):
    """Balanced n/2 real + n/2 fake, then shuffled so any prefix stays balanced."""
    rng = random.Random(seed)
    by_class = {0: [], 1: []}
    for path, label in samples:
        by_class[label].append((path, label))

    per_class = n // 2
    picked = []
    for label in (0, 1):
        pool = sorted(by_class[label])
        rng.shuffle(pool)
        if len(pool) < per_class:
            print(f"  only {len(pool)} {CLASS_NAMES[label]} available, "
                  f"wanted {per_class}")
        picked.extend(pool[:per_class])

    rng.shuffle(picked)
    return picked


def load_records():
    """Existing per-image results keyed by path, for resuming."""
    if not os.path.exists(RECORDS_PATH):
        return {}
    records = {}
    with open(RECORDS_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # a torn final line from a hard kill
            records[row["path"]] = row
    return records


def llm_fake_probability(verdict, confidence):
    """The VLM's verdict as a fake probability, matching fusion's convention.

    An unparseable verdict carries no information, so it sits at 0.5 rather
    than being scored as a confident "real".
    """
    if verdict == "fake":
        return float(confidence)
    if verdict == "real":
        return 1.0 - float(confidence)
    return 0.5


def score_with_classifier(samples):
    """Phase A. Every image through EfficientNet-B4, then free the GPU."""
    from torch.utils.data import DataLoader

    from evaluate import BATCH, FaceDataset, load_model, val_tfm

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(device)

    loader = DataLoader(FaceDataset(samples, val_tfm), batch_size=BATCH,
                        shuffle=False, num_workers=2,
                        pin_memory=(device.type == "cuda"))
    scores = {}
    with torch.no_grad():
        for i, (imgs, _, paths) in enumerate(loader, 1):
            fake_p = torch.softmax(model(imgs.to(device)), dim=1)[:, 1]
            for path, prob in zip(paths, fake_p.cpu().tolist()):
                scores[path] = float(prob)
            if i % 10 == 0 or i == len(loader):
                print(f"  batch {i}/{len(loader)}")

    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return scores


def run_reasoning_phase(pending, scores, fuse, informed=False):
    """Phase B. Qwen3-VL over the remaining images, appending as it goes."""
    from backend.app.llm.reasoner import run_reasoning

    done = 0
    with open(RECORDS_PATH, "a", encoding="utf-8") as out:
        for path, label in pending:
            t0 = time.time()
            crop = Image.open(path).convert("RGB").resize((IMG_SIZE, IMG_SIZE))

            try:
                llm = run_reasoning(
                    crop,
                    fake_score=scores[path] if informed else None)
            except Exception as exc:  # keep the run alive, record the failure
                llm = {"verdict": "unknown", "confidence": 0.0, "signals": [],
                       "explanation": f"reasoning failed: "
                                      f"{type(exc).__name__}: {exc}"}

            verdict = llm.get("verdict", "unknown")
            if verdict not in ("real", "fake"):
                verdict = "unknown"
            try:
                confidence = float(llm.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0

            classifier_score = scores[path]
            fused = fuse(classifier_score, {
                "verdict": verdict,
                "confidence": confidence,
                "signals": llm.get("signals", []),
                "explanation": llm.get("explanation", ""),
            })

            row = {
                "path": path.replace("\\", "/"),
                "label": int(label),
                "true_class": CLASS_NAMES[int(label)],
                "vision_fake_probability": classifier_score,
                "llm_verdict": verdict,
                "llm_confidence": confidence,
                "llm_fake_probability": llm_fake_probability(verdict, confidence),
                "fused_fake_probability": float(fused["fake_probability"]),
                "fused_verdict": fused["final_verdict"],
                "explanation": llm.get("explanation", ""),
                "signals": llm.get("signals", []),
                "seconds": round(time.time() - t0, 2),
            }
            out.write(json.dumps(row) + "\n")
            out.flush()  # survive a hard kill

            done += 1
            if done % 10 == 0 or done == len(pending):
                rate = row["seconds"]
                left = (len(pending) - done) * rate / 60
                print(f"  {done}/{len(pending)}  last {rate:.1f}s  "
                      f"~{left:.0f} min remaining")
    return done


def arm_metrics(records):
    labels = np.array([r["label"] for r in records])
    arms = {
        "vision_only": np.array([r["vision_fake_probability"] for r in records]),
        "llm_only": np.array([r["llm_fake_probability"] for r in records]),
        "fused": np.array([r["fused_fake_probability"] for r in records]),
    }
    out = {name: compute_metrics(labels, probs) for name, probs in arms.items()}
    unknown = sum(1 for r in records if r["llm_verdict"] == "unknown")
    out["llm_only"]["unparseable_verdicts"] = unknown
    out["llm_only"]["unparseable_rate"] = round(unknown / len(records), 4)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=DEFAULT_N,
                    help=f"images to sample, balanced (default {DEFAULT_N})")
    ap.add_argument("--restart", action="store_true",
                    help="discard existing records and start over")
    ap.add_argument("--informed", action="store_true",
                    help="give the VLM the classifier score, as production "
                         "does. Writes to a separate records file; measures "
                         "the deployed configuration rather than the blind "
                         "one the ablation needs (see ADR 0003).")
    args = ap.parse_args()

    global RECORDS_PATH, METRICS_PATH
    if args.informed:
        RECORDS_PATH, METRICS_PATH = INFORMED_RECORDS, INFORMED_METRICS
        print("INFORMED mode: the VLM receives the classifier score, as "
              "production does.")
        print("Not a valid LLM-Only ablation arm - this measures explanation "
              "quality")
        print("for the deployed configuration (see ADR 0003).")

    os.makedirs(RESULTS_DIR, exist_ok=True)
    if args.restart and os.path.exists(RECORDS_PATH):
        os.remove(RECORDS_PATH)
        print("Discarded previous records.")

    from backend.app.fusion.fusion import fuse

    print("Recovering the validation split...")
    _, val_samples = recover_splits()

    # Some validation images are byte-identical to training images (see
    # evaluate.py's duplicate check). The classifier has seen those, the
    # reasoning layer has not, so leaving them in would flatter the vision arm.
    leaked = leaked_keys()
    if leaked:
        before = len(val_samples)
        val_samples = [(p, l) for p, l in val_samples
                       if "/".join(p.replace("\\", "/").split("/")[-2:]) not in leaked]
        print(f"Excluded {before - len(val_samples)} leaked images, "
              f"{len(val_samples)} clean images remain")

    sample = stratified_sample(val_samples, args.n)
    n_fake = sum(1 for _, label in sample if label == 1)
    print(f"Sampled {len(sample)} images "
          f"({n_fake} fake / {len(sample) - n_fake} real)")

    existing = load_records()
    pending = [(p, l) for p, l in sample if p.replace("\\", "/") not in existing]
    if existing:
        print(f"Resuming: {len(existing)} already recorded, {len(pending)} to go")

    if pending:
        print("\nPhase A - classifier scores...")
        scores = score_with_classifier(pending)

        print(f"\nPhase B - Qwen3-VL reasoning over {len(pending)} images...")
        print("Safe to interrupt: finished images are already on disk.")
        t0 = time.time()
        run_reasoning_phase(pending, scores, fuse, informed=args.informed)
        print(f"Reasoning finished in {(time.time() - t0) / 60:.1f} min")
    else:
        print("Nothing pending - all sampled images already have records.")

    # ── metrics over everything recorded for this sample ──
    wanted = {p.replace("\\", "/") for p, _ in sample}
    records = [r for r in load_records().values() if r["path"] in wanted]
    if not records:
        sys.exit("No records to score.")

    metrics = arm_metrics(records)
    payload = {
        "sample": {
            "requested": args.n,
            "scored": len(records),
            "seed": ABLATION_SEED,
            "split": "validation",
            "stratified": True,
        },
        "note": "The reasoning layer ran blind (no classifier score in its "
                "prompt) so LLM-Only and Fused measure an independent signal.",
        "arms": metrics,
    }
    with open(METRICS_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    print("\n" + "=" * 66)
    print(f"ABLATION - {len(records)} images from the Validation Split")
    print("=" * 66)
    print(f"  {'arm':<14}{'accuracy':>10}{'AUC':>10}{'macro F1':>11}")
    for name in ("vision_only", "llm_only", "fused"):
        m = metrics[name]
        print(f"  {name:<14}{m['accuracy']:>10.4f}{m['auc_roc']:>10.4f}"
              f"{m['macro_f1']:>11.4f}")

    delta = metrics["fused"]["accuracy"] - metrics["vision_only"]["accuracy"]
    print(f"\n  Fused vs Vision-Only: {delta:+.4f} accuracy")
    print("  (the reasoning layer's marginal detection contribution)")
    unknown = metrics["llm_only"]
    print(f"  Unparseable VLM verdicts: {unknown['unparseable_verdicts']} "
          f"({unknown['unparseable_rate']:.1%})")
    print("=" * 66)
    print(f"\nWrote {METRICS_PATH}")
    print(f"Per-image records in {RECORDS_PATH}")


if __name__ == "__main__":
    main()
