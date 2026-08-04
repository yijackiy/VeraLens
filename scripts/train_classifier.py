"""
Train EfficientNet-B4 on data/deepfake_faces/ for deepfake detection.

Dataset layout expected:
    data/deepfake_faces/real/   (16,060 images, label = 0)
    data/deepfake_faces/fake/   (16,060 images, label = 1)

Two-phase training (linear probe → full fine-tune):
  Phase 1: freeze backbone, train classifier head only (fast, 5 epochs)
  Phase 2: unfreeze all layers, lower LR (5 epochs)

Output: backend/models/effnb4_deepfake.pt
"""

import os
import sys
import time
import random
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import timm
from sklearn.metrics import roc_auc_score

# ── reproducibility ──────────────────────────────────────────────────────────
SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

# ── paths ────────────────────────────────────────────────────────────────────
DATA_DIR    = "data/deepfake_faces"
SAVE_PATH   = "backend/models/effnb4_deepfake.pt"
LOG_EVERY   = 50   # batches

# ── hyper-params ─────────────────────────────────────────────────────────────
BATCH        = 32
IMG_SIZE     = 224
PHASE1_LR    = 1e-3
PHASE2_LR    = 3e-5
PHASE1_EP    = 5
PHASE2_EP    = 5
VAL_SPLIT    = 0.1
WORKERS      = 2


# ── dataset ──────────────────────────────────────────────────────────────────
class FaceDataset(Dataset):
    def __init__(self, samples, tfm):
        self.samples = samples
        self.tfm = tfm

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return self.tfm(img), label


def build_splits(data_dir, val_split=VAL_SPLIT):
    samples = []
    for label, folder in [(0, "real"), (1, "fake")]:
        d = os.path.join(data_dir, folder)
        for fname in os.listdir(d):
            if fname.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                samples.append((os.path.join(d, fname), label))
    random.shuffle(samples)
    cut = int(len(samples) * (1 - val_split))
    return samples[:cut], samples[cut:]


train_tfm = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

val_tfm = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


# ── evaluation ───────────────────────────────────────────────────────────────
def evaluate(model, loader, device):
    model.eval()
    all_labels, all_probs = [], []
    correct = total = 0
    with torch.no_grad():
        for imgs, labels in loader:
            imgs, labels = imgs.to(device), labels.to(device)
            logits = model(imgs)
            probs = torch.softmax(logits, dim=1)[:, 1]
            preds = logits.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            all_labels.extend(labels.cpu().tolist())
            all_probs.extend(probs.cpu().tolist())
    acc = correct / total
    auc = roc_auc_score(all_labels, all_probs)
    return acc, auc


# ── training loop ─────────────────────────────────────────────────────────────
def run_phase(model, loader, val_loader, optimizer, epochs, device, phase_name):
    criterion = nn.CrossEntropyLoss()
    for ep in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        t0 = time.time()
        for step, (imgs, labels) in enumerate(loader, 1):
            imgs, labels = imgs.to(device), labels.to(device)
            optimizer.zero_grad()
            loss = criterion(model(imgs), labels)
            loss.backward()
            optimizer.step()
            running_loss += loss.item()
            if step % LOG_EVERY == 0:
                print(f"  [{phase_name}] ep {ep}/{epochs}  step {step}/{len(loader)}"
                      f"  loss {running_loss/step:.4f}")
        acc, auc = evaluate(model, val_loader, device)
        elapsed = time.time() - t0
        print(f"[{phase_name}] ep {ep}/{epochs}  "
              f"val_acc={acc:.4f}  val_auc={auc:.4f}  ({elapsed:.0f}s)")
    return model


def main():
    os.makedirs(os.path.dirname(SAVE_PATH), exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if device.type == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"VRAM free: {torch.cuda.mem_get_info()[0]/1e9:.1f} GB")

    print("Loading dataset...")
    train_samples, val_samples = build_splits(DATA_DIR)
    print(f"Train: {len(train_samples)}  Val: {len(val_samples)}")

    train_ds = FaceDataset(train_samples, train_tfm)
    val_ds   = FaceDataset(val_samples,   val_tfm)

    pin = device.type == "cuda"
    train_loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True,
                              num_workers=WORKERS, pin_memory=pin)
    val_loader   = DataLoader(val_ds,   batch_size=BATCH, shuffle=False,
                              num_workers=WORKERS, pin_memory=pin)

    # ── model ──
    model = timm.create_model("efficientnet_b4", pretrained=True, num_classes=2)
    model = model.to(device)

    # ── Phase 1: linear probe (head only) ──
    print("\n=== Phase 1: linear probe (backbone frozen) ===")
    for name, param in model.named_parameters():
        param.requires_grad = "classifier" in name
    optimizer = torch.optim.Adam(
        filter(lambda p: p.requires_grad, model.parameters()), lr=PHASE1_LR)
    model = run_phase(model, train_loader, val_loader, optimizer,
                      PHASE1_EP, device, "P1")

    # ── Phase 2: full fine-tune ──
    print("\n=== Phase 2: full fine-tune (all layers) ===")
    for param in model.parameters():
        param.requires_grad = True
    optimizer = torch.optim.Adam(model.parameters(), lr=PHASE2_LR)
    model = run_phase(model, train_loader, val_loader, optimizer,
                      PHASE2_EP, device, "P2")

    # ── save ──
    torch.save(model.state_dict(), SAVE_PATH)
    print(f"\nCheckpoint saved → {SAVE_PATH}")

    # ── final eval ──
    acc, auc = evaluate(model, val_loader, device)
    print(f"Final  val_acc={acc:.4f}  val_auc={auc:.4f}")


if __name__ == "__main__":
    main()
