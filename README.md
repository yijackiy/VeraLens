# VeraLens — Photo-Only Deepfake Detection with LLM Explainability

VeraLens decides whether a photograph of a face was synthetically generated, and explains
that decision in natural language. A pretrained-and-fine-tuned EfficientNet-B4 produces a
Fake Probability and a Grad-CAM saliency map; Qwen3-VL-2B-Instruct then examines the same
face crop and writes a structured forensic explanation; a fusion layer combines both into
one verdict. Everything on the inference path runs locally.

**Hardware target: GTX 1650 (4GB VRAM) + 16GB RAM.** Every model choice here is downstream
of that budget.

Bachelor thesis project. The contribution is the integration architecture, the fusion
layer and the explainability pipeline — not the visual backbone.

---

## Pipeline

```
Submitted Photo
  ├─ POST /detect   → InsightFace: every face, boxes + scores (CPU, ~0.2 s)
  │                   └─ the browser picks one when there is more than one
  └─ POST /analyze (token + face_index)        ── under a single GPU lock ──
        EfficientNet-B4 (fine-tuned) ─► Fake Probability
        Grad-CAM                     ─► Saliency Map (PNG under /static)
        unload classifier + CAM      ─► frees VRAM before the VLM loads
        Qwen3-VL-2B-Instruct (4-bit) ─► verdict, confidence, signals, explanation
        Fusion 0.55·vision + 0.45·llm ─► final verdict + confidence
```

The two models are **never resident on the GPU at the same time** — 4GB does not allow it.
One analysis runs at a time (`threading.Lock`), and takes **60 s at the median** — 40 s at the
floor, 169 s at p90 (n=600, `results/ablation_records*.jsonl`).

| Endpoint | Purpose |
|---|---|
| `GET /health` | Dependency-free liveness probe (keep-alive cron pings it every 10 min) |
| `POST /detect` | Upload → `{token, faces[]}`, or `{"faces": []}` when none are found |
| `POST /analyze` | `token` + `face_index` → the full Analysis |
| `/static/heatmaps/…` | Generated saliency overlays |

---

## Setup

Python 3.13. **Install PyTorch first**, from the CUDA 12.4 index — otherwise pip resolves
to CPU wheels and the whole pipeline runs on the CPU without saying so:

```bash
python -m venv venv && source venv/Scripts/activate   # Windows Git Bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
cp .env.example .env
```

Two dependency traps, both already pinned in `requirements.txt` — do not "fix" them:

- `onnxruntime-gpu==1.22.0` is pinned **low on purpose**. 1.23+ is built against CUDA 13
  while torch here is the CUDA 12 wheel; unpinned, the CUDA execution provider fails to
  load and ONNX Runtime falls back to CPU silently (ADR 0011).
- Never also install `onnxruntime`. Both packages write the same package directory, the
  CPU build wins, and `CUDAExecutionProvider` disappears from the provider list.

The classifier checkpoint `backend/models/effnb4_deepfake.pt` is git-ignored. Without it
the classifier **silently falls back to ImageNet weights** and every verdict is noise —
check the startup line it prints.

## Running

```bash
uvicorn backend.app.api.main:app --reload      # http://localhost:8000
cd frontend && npm install && npm run dev      # http://localhost:5173
```

Or the whole thing:

```bash
docker compose up --build      # first build: 20–40 min, several GB
```

Compose bind-mounts the checkpoint, the HuggingFace cache (Qwen3-VL is ~4GB) and the
InsightFace cache (~300MB) rather than baking them into the image.

## Tests and linting

```bash
pytest                       # backend
cd frontend && npm test      # Vitest
cd frontend && npm run lint  # oxlint
```

## Evaluation

All evaluation is offline batch work. **Nothing here is on the inference path.**

```bash
python scripts/evaluate.py               # 4.1 Detection Metrics
python scripts/evaluate_ablation.py      # 4.2 Vision-Only / LLM-Only / Fused
python scripts/evaluate_explanations.py  # 4.3 ROUGE + diversity
python scripts/run_judge_eval.py         # 4.4 LLM-as-judge
python scripts/compare_informed.py       # blind vs production explanations
python scripts/report_results.py         # regenerates results/RESULTS.md
```

`scripts/export_showcase.py` builds the static, GPU-free demo under `showcase/`;
`scripts/keepalive.py` and `scripts/backup_judge_scores.py` support a deployed demo.

## Configuration

Environment only — see `.env.example`. Nothing reads a committed config file and no
default is ever a real key.

| Variable | Default | Notes |
|---|---|---|
| `JUDGE_PROVIDER` | `gemini` | `local` runs the on-device Qwen judge; no data leaves the machine |
| `GEMINI_API_KEY` | — | Required for `gemini`. Free tier: 10 req/min, 250 req/day |
| `JUDGE_MODEL` | `gemini-2.5-flash` | The exact resolved version is recorded on every score row |
| `JUDGE_RPM` / `JUDGE_DAILY_QUOTA` | `10` / `250` | Client-side throttle; backoff alone will not save a batch run |
| `DATABASE_URL` | SQLite `data/judge.db` | Dev fallback. Final results belong in Neon/Supabase |
| `VERALENS_FACE_DEVICE` | `cpu` | `cuda` is 0.2 s faster but holds ~805 MiB for the process lifetime (ADR 0011) |

## Dataset

`pujanpaudel/deepfake_face_classification` (Hugging Face, CC BY-NC 4.0, derived from the
DF40 benchmark). **32,120 images, balanced 16,060 / 16,060**, laid out as
`data/deepfake_faces/real/` (label 0) and `data/deepfake_faces/fake/` (label 1).
Photo-only; video is out of scope.

> `scripts/download_dataset.py` is **stale** and will not reproduce that layout: it calls
> `load_from_disk("data/celebdf")` against an already-downloaded dataset and uses the
> opposite label convention (1 = real). Treat it as a historical artefact, not as setup
> instructions, until it is rewritten.

Two properties matter for any number you report:

- **No held-out test set exists.** `build_splits()` only ever produced a 90/10
  train/validation pair, and that validation data informed the two-phase training
  schedule. Everything reported is Validation Performance (ADR 0001).
- **413 of 3,212 validation images (12.86%) are byte-identical to a training image.**
  Headline metrics use the leakage-free subset of 2,799 (ADR 0004).

## Results

| Metric (leakage-free subset, 2,799 images) | Value |
|---|---|
| Accuracy | 0.9750 |
| AUC-ROC | 0.9973 |
| Macro F1 | 0.9750 |

The three-arm ablation (400 images, reasoning layer run blind) gives Vision-Only 0.9775,
LLM-Only 0.6625, Fused 0.9825 — but the fused gain rests on four discordant images,
McNemar exact p = 0.6250, and AUC moves the other way. **Fusion is not claimed to improve
detection** (ADR 0005).

What does hold: told what the classifier found — in words, not as a number (ADR 0008) —
the reasoning layer explains significantly better on fakes (+0.91 judge points,
sign-test p = 0.0015). That is the thesis's actual claim.

Full tables, the judge's self-evaluation caveat and the limitations section:
[`results/RESULTS.md`](results/RESULTS.md).

## Where to read next

- [`CONTEXT.md`](CONTEXT.md) — the domain vocabulary. Terms here are load-bearing; each
  entry also lists the words **not** to use.
- [`docs/adr/`](docs/adr/) — 11 decision records. Read 0001, 0004 and 0005 before quoting
  any number, and 0011 before changing anything about device placement.
- `../Veralens Info.md` — the full current-state project snapshot.
- [`showcase/README.md`](showcase/README.md) — publishing the static demo.

## Scope

Photo-only, by decision. No video, no FFmpeg, no temporal analysis (cut to protect the
deadline). Document OCR, MRZ parsing and face-comparison identity verification belong to
the shelved VeraID concept and are recorded as future work. The judge is
evaluation-only — no external API is ever called while serving a request.
