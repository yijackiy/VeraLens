"""
Detection Metrics for the EfficientNet-B4 classifier (build guide step 4.1).

Reports Validation Performance on the Validation Split recovered from the
4 August training run. See docs/adr/0001-metrics-from-recovered-validation-split.md
for why this is a validation split and not a test set.

Split recovery
--------------
train_classifier.py seeds Python's `random` with 42 at import and does not
consume that RNG again before `build_splits()` shuffles. Re-seeding immediately
before an identical shuffle therefore reproduces the original split, provided
data/deepfake_faces/ is unchanged (it has not been modified since 1 August,
three days before the checkpoint was written).

Recovery is self-verifying: the 4 August run recorded val_acc 0.9782 and
val_auc 0.9976. If this script reproduces those, both the recovery and the
recorded figure are confirmed. A mismatch means recovery failed and nothing
here should be cited.

Outputs (results/):
    split_manifest.json     which images are in which split
    detection_metrics.json  accuracy, AUC, precision/recall/F1, confusion matrix
    confident_errors.json   most confident wrong predictions
    duplicate_check.json    identical images appearing in both class folders
    roc_curve.png
    confusion_matrix.png

Usage:
    python scripts/evaluate.py
    python scripts/evaluate.py --skip-dupcheck
"""

import argparse
import hashlib
import json
import os
import random
import sys
import time
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import timm
import torch
from PIL import Image
from sklearn.metrics import (
    accuracy_score,
    auc as auc_fn,
    confusion_matrix,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

# ── run from the repo root so paths match training exactly ───────────────────
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)

# Windows consoles default to cp1252 and raise on non-ASCII output.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── constants mirrored from train_classifier.py (must not drift) ─────────────
SEED = 42
DATA_DIR = "data/deepfake_faces"
CKPT_PATH = "backend/models/effnb4_deepfake.pt"
RESULTS_DIR = "results"
IMG_SIZE = 224
BATCH = 32
VAL_SPLIT = 0.1
WORKERS = 2

# Reference figures from the 4 August run, recorded in a session handoff.
REF_ACC = 0.9782
REF_AUC = 0.9976
REF_TOLERANCE = 0.005

CLASS_NAMES = ["real", "fake"]  # index == label: real=0, fake=1

val_tfm = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


class FaceDataset(Dataset):
    """Mirrors train_classifier.FaceDataset, but also returns the path."""

    def __init__(self, samples, tfm):
        self.samples = samples
        self.tfm = tfm

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return self.tfm(img), label, path


def build_splits(data_dir=DATA_DIR, val_split=VAL_SPLIT):
    """Byte-for-byte the logic from train_classifier.build_splits."""
    samples = []
    for label, folder in [(0, "real"), (1, "fake")]:
        d = os.path.join(data_dir, folder)
        for fname in os.listdir(d):
            if fname.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                samples.append((os.path.join(d, fname), label))
    random.shuffle(samples)
    cut = int(len(samples) * (1 - val_split))
    return samples[:cut], samples[cut:]


def recover_splits():
    """Reproduce the 4 August split. Re-seeds immediately before shuffling."""
    random.seed(SEED)
    return build_splits()


# ── data integrity ───────────────────────────────────────────────────────────
def file_hash(path, chunk=1 << 20):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def duplicate_check(train_samples, val_samples):
    """Find byte-identical images across labels, and leakage across the split.

    Two distinct risks:
      1. The same image under both labels means the archive extraction
         mis-routed files, which would make every metric here meaningless.
      2. A duplicated image with one copy in train and another in validation
         means the model has effectively seen that validation image, which
         inflates Validation Performance.
    """
    by_hash = defaultdict(list)
    counts = {}
    for folder in CLASS_NAMES:
        d = os.path.join(DATA_DIR, folder)
        names = [f for f in os.listdir(d)
                 if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
        counts[folder] = len(names)
        for i, fname in enumerate(names, 1):
            path = os.path.join(d, fname)
            by_hash[file_hash(path)].append(f"{folder}/{fname}")
            if i % 4000 == 0:
                print(f"  hashed {folder}: {i}/{len(names)}")

    cross, within = [], []
    for digest, members in by_hash.items():
        if len(members) < 2:
            continue
        folders = {m.split("/", 1)[0] for m in members}
        (cross if len(folders) > 1 else within).append(
            {"hash": digest, "files": sorted(members)})

    # ── split leakage: a validation image whose bytes also appear in train ──
    def key(path):
        return "/".join(path.replace("\\", "/").split("/")[-2:])

    hash_of = {}
    for digest, members in by_hash.items():
        for m in members:
            hash_of[m] = digest

    train_hashes = {hash_of[key(p)] for p, _ in train_samples if key(p) in hash_of}
    leaked = [key(p) for p, _ in val_samples
              if hash_of.get(key(p)) in train_hashes]

    # Filename collisions across folders are a weaker but still useful signal:
    # the extraction concern was first noticed through overlapping names.
    names_by_folder = {
        f: {n for n in os.listdir(os.path.join(DATA_DIR, f))
            if n.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))}
        for f in CLASS_NAMES
    }
    shared_names = sorted(names_by_folder["real"] & names_by_folder["fake"])

    return {
        "image_counts": counts,
        "cross_folder_duplicate_groups": len(cross),
        "cross_folder_duplicates": cross[:100],
        "within_folder_duplicate_groups": len(within),
        "shared_filename_count": len(shared_names),
        "shared_filenames_sample": shared_names[:100],
        "split_leakage": {
            "validation_images_also_in_train": len(leaked),
            "validation_size": len(val_samples),
            "leakage_rate": round(len(leaked) / len(val_samples), 4),
            "leaked_files": sorted(leaked),
        },
    }


def leaked_keys():
    """The leaked validation files recorded by the last duplicate_check run.

    Lets other scripts (the ablation) sample only from clean images without
    re-hashing the whole dataset.
    """
    path = os.path.join(RESULTS_DIR, "duplicate_check.json")
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as fh:
        return set(json.load(fh)["split_leakage"]["leaked_files"])


# ── inference ────────────────────────────────────────────────────────────────
def load_model(device):
    model = timm.create_model("efficientnet_b4", pretrained=False, num_classes=2)
    state = torch.load(CKPT_PATH, map_location=device)
    model.load_state_dict(state)
    return model.to(device).eval()


def predict(model, samples, device):
    """Return (labels, fake_probabilities, paths) for the given samples."""
    loader = DataLoader(
        FaceDataset(samples, val_tfm), batch_size=BATCH, shuffle=False,
        num_workers=WORKERS, pin_memory=(device.type == "cuda"))

    labels, probs, paths = [], [], []
    total_batches = len(loader)
    with torch.no_grad():
        for i, (imgs, ys, ps) in enumerate(loader, 1):
            logits = model(imgs.to(device))
            fake_p = torch.softmax(logits, dim=1)[:, 1]
            labels.extend(ys.tolist())
            probs.extend(fake_p.cpu().tolist())
            paths.extend(ps)
            if i % 20 == 0 or i == total_batches:
                print(f"  batch {i}/{total_batches}")
    return np.array(labels), np.array(probs), paths


# ── metrics ──────────────────────────────────────────────────────────────────
def compute_metrics(labels, probs, threshold=0.5):
    preds = (probs >= threshold).astype(int)
    prec, rec, f1, support = precision_recall_fscore_support(
        labels, preds, labels=[0, 1], zero_division=0)
    cm = confusion_matrix(labels, preds, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()

    return {
        "n_samples": int(len(labels)),
        "threshold": threshold,
        "accuracy": float(accuracy_score(labels, preds)),
        "auc_roc": float(roc_auc_score(labels, probs)),
        "macro_f1": float(f1.mean()),
        "per_class": {
            CLASS_NAMES[i]: {
                "precision": float(prec[i]),
                "recall": float(rec[i]),
                "f1": float(f1[i]),
                "support": int(support[i]),
            }
            for i in (0, 1)
        },
        "confusion_matrix": {
            "true_real_pred_real": int(tn),
            "true_real_pred_fake": int(fp),
            "true_fake_pred_real": int(fn),
            "true_fake_pred_fake": int(tp),
            "matrix_rows_true_cols_pred": cm.tolist(),
        },
    }


def confident_errors(labels, probs, paths, top_n):
    """Wrong predictions ranked by how confident the model was.

    If archive extraction mis-routed images, mislabelled files surface here:
    the model calls them correctly, the stored label disagrees, and the
    disagreement is maximally confident.
    """
    rows = []
    for label, prob, path in zip(labels, probs, paths):
        pred = int(prob >= 0.5)
        if pred != label:
            rows.append({
                "path": path.replace("\\", "/"),
                "true_label": CLASS_NAMES[int(label)],
                "predicted": CLASS_NAMES[pred],
                "fake_probability": round(float(prob), 6),
                "error_margin": round(abs(float(prob) - 0.5), 6),
            })
    rows.sort(key=lambda r: r["error_margin"], reverse=True)
    return rows[:top_n], len(rows)


# ── plots ────────────────────────────────────────────────────────────────────
def plot_roc(labels, probs, path):
    fpr, tpr, _ = roc_curve(labels, probs)
    fig, ax = plt.subplots(figsize=(5.5, 5))
    ax.plot(fpr, tpr, lw=2, label=f"EfficientNet-B4 (AUC = {auc_fn(fpr, tpr):.4f})")
    ax.plot([0, 1], [0, 1], "k--", lw=1, label="chance")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title("ROC — Validation Split")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_confusion(cm, path):
    fig, ax = plt.subplots(figsize=(4.5, 4))
    ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1], labels=CLASS_NAMES)
    ax.set_yticks([0, 1], labels=CLASS_NAMES)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title("Confusion matrix — Validation Split")
    peak = cm.max()
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{cm[i, j]:,}", ha="center", va="center",
                    color="white" if cm[i, j] > peak / 2 else "black")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def save(obj, name):
    path = os.path.join(RESULTS_DIR, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--skip-dupcheck", action="store_true",
                    help="skip the cross-folder duplicate image scan")
    ap.add_argument("--top-errors", type=int, default=50,
                    help="how many confident errors to record (default 50)")
    args = ap.parse_args()

    os.makedirs(RESULTS_DIR, exist_ok=True)
    if not os.path.exists(CKPT_PATH):
        sys.exit(f"Checkpoint not found: {CKPT_PATH}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if device.type == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    # ── recover the split ──
    print("\nRecovering the 4 August split...")
    train_samples, val_samples = recover_splits()
    val_fakes = sum(1 for _, l in val_samples if l == 1)
    print(f"Train: {len(train_samples):,}   Validation: {len(val_samples):,} "
          f"({val_fakes:,} fake / {len(val_samples) - val_fakes:,} real)")

    save({
        "seed": SEED,
        "val_split": VAL_SPLIT,
        "note": "Recovered by re-running train_classifier.build_splits under "
                "seed 42. This is a validation split, not a held-out test set.",
        "counts": {"train": len(train_samples), "validation": len(val_samples)},
        "train": [[p.replace("\\", "/"), l] for p, l in train_samples],
        "validation": [[p.replace("\\", "/"), l] for p, l in val_samples],
    }, "split_manifest.json")
    print(f"Split manifest -> {RESULTS_DIR}/split_manifest.json")

    # ── inference ──
    print("\nScoring the validation split...")
    t0 = time.time()
    model = load_model(device)
    labels, probs, paths = predict(model, val_samples, device)
    print(f"Scored {len(labels):,} images in {time.time() - t0:.0f}s")

    # ── metrics ──
    metrics = compute_metrics(labels, probs)
    errors, n_errors = confident_errors(labels, probs, paths, args.top_errors)

    delta_acc = metrics["accuracy"] - REF_ACC
    delta_auc = metrics["auc_roc"] - REF_AUC
    reproduced = (abs(delta_acc) <= REF_TOLERANCE and abs(delta_auc) <= REF_TOLERANCE)

    metrics["split"] = "validation"
    metrics["checkpoint"] = CKPT_PATH
    metrics["reference_check"] = {
        "reference_accuracy": REF_ACC,
        "reference_auc": REF_AUC,
        "tolerance": REF_TOLERANCE,
        "delta_accuracy": round(delta_acc, 6),
        "delta_auc": round(delta_auc, 6),
        "split_recovery_confirmed": bool(reproduced),
    }

    save(metrics, "detection_metrics.json")
    save({"total_errors": n_errors, "listed": len(errors), "errors": errors},
         "confident_errors.json")
    plot_roc(labels, probs, os.path.join(RESULTS_DIR, "roc_curve.png"))
    plot_confusion(np.array(metrics["confusion_matrix"]["matrix_rows_true_cols_pred"]),
                   os.path.join(RESULTS_DIR, "confusion_matrix.png"))

    # ── data integrity ──
    if args.skip_dupcheck:
        print("\nSkipping duplicate check (--skip-dupcheck).")
        dup = None
    else:
        print("\nChecking for images duplicated across real/ and fake/...")
        dup = duplicate_check(train_samples, val_samples)
        save(dup, "duplicate_check.json")

    # ── the honest number: drop validation images the model saw in training ──
    clean = None
    if dup:
        leaked = set(dup["split_leakage"]["leaked_files"])
        keep = np.array(["/".join(p.replace("\\", "/").split("/")[-2:]) not in leaked
                         for p in paths])
        if 0 < keep.sum() < len(keep):
            clean = compute_metrics(labels[keep], probs[keep])
            clean["excluded_leaked_images"] = int((~keep).sum())
            metrics["clean_subset"] = clean
            save(metrics, "detection_metrics.json")

    # ── summary ──
    cm = metrics["confusion_matrix"]
    print("\n" + "=" * 62)
    print("DETECTION METRICS — Validation Split")
    print("=" * 62)
    print(f"  Samples          {metrics['n_samples']:,}")
    print(f"  Accuracy         {metrics['accuracy']:.4f}")
    print(f"  AUC-ROC          {metrics['auc_roc']:.4f}")
    print(f"  Macro F1         {metrics['macro_f1']:.4f}")
    for name in CLASS_NAMES:
        c = metrics["per_class"][name]
        print(f"  {name:<5}            P {c['precision']:.4f}  "
              f"R {c['recall']:.4f}  F1 {c['f1']:.4f}  (n={c['support']:,})")
    print(f"  Confusion        real->real {cm['true_real_pred_real']:,}  "
          f"real->fake {cm['true_real_pred_fake']:,}")
    print(f"                   fake->real {cm['true_fake_pred_real']:,}  "
          f"fake->fake {cm['true_fake_pred_fake']:,}")

    print("\n  Split recovery check vs the 4 August run")
    print(f"    accuracy  {metrics['accuracy']:.4f} vs {REF_ACC:.4f} "
          f"(delta {delta_acc:+.4f})")
    print(f"    auc       {metrics['auc_roc']:.4f} vs {REF_AUC:.4f} "
          f"(delta {delta_auc:+.4f})")
    if reproduced:
        print("    CONFIRMED — the recovered split reproduces the recorded figures.")
    else:
        print("    MISMATCH — recovery is not confirmed. Treat these numbers as")
        print("    a fresh measurement of this checkpoint and do not cite the")
        print("    4 August figures.")

    if dup:
        print(f"\n  Data integrity")
        print(f"    images                        "
              f"real {dup['image_counts']['real']:,} / "
              f"fake {dup['image_counts']['fake']:,}")
        print(f"    identical across both folders {dup['cross_folder_duplicate_groups']:,}")
        print(f"    filenames in both folders     {dup['shared_filename_count']:,}")
        print(f"    duplicates within a folder    {dup['within_folder_duplicate_groups']:,} groups")
        leak = dup["split_leakage"]
        print(f"    validation images also seen   "
              f"{leak['validation_images_also_in_train']:,} "
              f"({leak['leakage_rate']:.2%}) in training")
        if dup["cross_folder_duplicate_groups"]:
            print("    WARNING: the same image appears under both labels. Extraction")
            print("    mis-routing is real and these metrics are not trustworthy.")
        if leak["validation_images_also_in_train"]:
            print("    NOTE: duplicate images straddle the split, so Validation")
            print("    Performance is optimistic. Report this as a limitation.")

    if clean:
        print(f"\n  Leakage-free subset "
              f"({clean['n_samples']:,} images, "
              f"{clean['excluded_leaked_images']:,} excluded)")
        print(f"    Accuracy       {clean['accuracy']:.4f}  "
              f"(vs {metrics['accuracy']:.4f} on the full split)")
        print(f"    AUC-ROC        {clean['auc_roc']:.4f}  "
              f"(vs {metrics['auc_roc']:.4f})")
        print("    This is the figure to lead with: it excludes every image the")
        print("    classifier had already seen during training.")

    print(f"\n  Errors           {n_errors:,} wrong "
          f"({n_errors / metrics['n_samples']:.2%}), "
          f"top {len(errors)} written to confident_errors.json")
    if errors:
        print("  Most confident mistakes (check these for mislabelling):")
        for row in errors[:5]:
            print(f"    {row['true_label']:>4} -> {row['predicted']:<4} "
                  f"p(fake)={row['fake_probability']:.4f}  {row['path']}")
    print("=" * 62)
    print(f"\nWrote results to {RESULTS_DIR}/")


if __name__ == "__main__":
    main()
