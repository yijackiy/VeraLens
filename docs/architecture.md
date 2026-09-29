# VeraLens — Architecture Diagrams

Drawn from the code on 23 September 2026. Every box names a real module, and every
number (224×224, 4-bit, 0.55/0.45, 805 MiB, 15–90 s) is taken from the source or from
`results/RESULTS.md` rather than estimated. Terms follow [`../CONTEXT.md`](../CONTEXT.md).

Diagrams are Mermaid, so they render on GitHub and can be exported to SVG/PNG for the
thesis. If any of these stops matching the code, fix the code or fix the diagram — do not
leave both.

---

## 1. System overview

The inference path is entirely local. The judge is drawn deliberately **outside** it: it
never runs while a request is being served (ADR 0007, and the "evaluation-only" rule in
CLAUDE.md).

```mermaid
flowchart TB
    subgraph browser["Browser — React 19 / Vite 8 / Tailwind v4"]
        UI["App.jsx phase machine<br/>11 screens"]
        CLIENT["api/client.js<br/>detectFaces → analyzeFace"]
        UI <--> CLIENT
    end

    subgraph backend["FastAPI backend — one process, one GPU"]
        API["api/main.py<br/>/health · /detect · /analyze<br/>_gpu_lock · _pending tokens"]
        PIPE["pipeline.py<br/>run_pipeline_from_crop()"]
        API --> PIPE

        subgraph models["Inference modules"]
            FACE["preprocessing/face_pipeline.py<br/>InsightFace buffalo_l<br/>CPU by default · ADR 0011"]
            CLS["classifier/classifier.py<br/>EfficientNet-B4 · timm<br/>effnb4_deepfake.pt"]
            CAM["classifier/gradcam.py<br/>Grad-CAM on conv_head"]
            LLM["llm/reasoner.py + model.py<br/>Qwen3-VL-2B-Instruct · 4-bit"]
            FUSE["fusion/fusion.py<br/>0.55 vision / 0.45 llm"]
        end

        API --> FACE
        PIPE --> CLS & CAM & LLM & FUSE
        STATIC[("backend/static/heatmaps/<br/>saliency PNGs")]
        PIPE --> STATIC
    end

    subgraph offline["Offline only — never on the request path"]
        EVAL["scripts/evaluate*.py<br/>detection · ablation · ROUGE"]
        JUDGE["eval/judge.py → IJudge<br/>judge_gemini.py | judge_local.py"]
        STORE[("judge_scores<br/>append-only · SQLite/Postgres")]
        RES["results/RESULTS.md"]
        EVAL --> JUDGE --> STORE
        EVAL --> RES
    end

    CLIENT -- "POST /detect (multipart)" --> API
    CLIENT -- "POST /analyze (token, face_index)" --> API
    CLIENT -- "GET /static/heatmaps/*.png" --> STATIC
    EVAL -. "imports the same modules,<br/>batch, never live" .-> PIPE

    classDef off fill:#fff4e6,stroke:#c77700,stroke-dasharray:4 3
    class offline,EVAL,JUDGE,STORE,RES off
```

---

## 2. One analysis, end to end

Two requests, not one. Detection is cheap (~0.2 s on the CPU default) and has to answer
before anything slow starts, because the picker needs the box list. The token carries the
uploaded file across to the second request.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as api/main.py
    participant F as face_pipeline
    participant P as pipeline.py
    participant C as classifier + Grad-CAM
    participant Q as Qwen3-VL-2B

    B->>A: POST /detect (image file)
    A->>F: detect_all_faces(path)
    F-->>A: faces sorted left→right (bbox, det_score)
    alt no face found
        A-->>B: {"faces": []} → ProblemScreen
    else one or more
        A-->>B: {token, faces[]}  ~0.2 s
        Note over A: _pending[token] = (temp path, faces)
        opt more than one face
            B->>B: FacePickerScreen — user chooses
        end
        B->>A: POST /analyze (token, face_index)
        Note over A: _pending.pop(token) · acquire _gpu_lock
        A->>P: run_pipeline_from_crop(crop, face_count)
        P->>C: classify(crop) → fake_score
        P->>C: get_heatmap(crop) → saliency PNG
        P->>C: unload_cam() + unload_model()
        Note right of C: VRAM freed before the VLM loads
        P->>Q: run_reasoning(crop, fake_score)
        Note right of Q: verdict stated in WORDS (ADR 0008)<br/>up to 3 attempts, sampled on retry
        Q-->>P: {verdict, confidence, signals[], explanation}
        P->>P: fuse(fake_score, llm_result)
        P-->>A: verdict + probabilities + heatmap_url + elapsed_seconds
        A-->>B: JSON (15–90 s later, one response)
        B->>A: GET /static/heatmaps/<uuid>.png
    end
```

`/analyze` is a plain `def`, not `async def`, so Starlette runs it in the threadpool and
`/health` keeps answering while an analysis blocks for a minute.

---

## 3. The VRAM handoff

The reason the pipeline is shaped the way it is. 4096 MiB total; the two models are never
resident together.

```mermaid
gantt
    title GPU residency during one analysis (GTX 1650, 4 GB)
    dateFormat X
    axisFormat %s

    section Face detection
    InsightFace on CPU by default (CUDA would hold 805 MiB for the process lifetime)  :done, det, 0, 1

    section Classifier
    EfficientNet-B4 loaded          :active, cls, 1, 3
    Grad-CAM over the same weights  :active, cam, 2, 3
    unload_cam() + unload_model()   :crit, free, 3, 4

    section Reasoning
    Qwen3-VL-2B loaded 4-bit        :active, llm, 4, 9

    section Fusion
    Arithmetic only, no GPU         :fus, 9, 10
```

Grad-CAM **must** run before the unload: it needs the classifier's loaded weights. A
`threading.Lock` around the whole span keeps two requests from unloading a model out from
under each other.

---

## 4. Fusion logic

```mermaid
flowchart TD
    IN["classifier fake_score ∈ [0,1]<br/>llm_result{verdict, confidence}"] --> Q{"llm verdict<br/>== 'unknown'?"}

    Q -- "yes — parse failed<br/>after 3 attempts" --> FALL["final_score = classifier_score<br/>explanation_available = false"]
    Q -- "no" --> MAP["llm_fake_prob =<br/>verdict == fake ? confidence : 1 − confidence"]
    MAP --> W["final_score =<br/>0.55 · classifier + 0.45 · llm"]

    FALL --> T{"final_score > 0.5?"}
    W --> T
    T -- yes --> FK["final_verdict = FAKE<br/>final_confidence = final_score"]
    T -- no --> RL["final_verdict = REAL<br/>final_confidence = 1 − final_score"]

    FK --> OUT["fake_probability = final_score  (always toward fake — feed metrics this)<br/>final_confidence  (confidence in the verdict stated — show the user this)<br/>classifier_score  (pre-fusion, so the 0.55/0.45 split stays visible)<br/>signals[] · explanation · explanation_available"]
    RL --> OUT
```

Three details that exist because their absence was a bug: the `unknown` branch (a failed
parse has `confidence = 0.0`, which would otherwise compute to a 1.0 fake probability),
the split between `fake_probability` and `final_confidence` (a REAL verdict at 0.18 read
as "REAL (18.0%)"), and surfacing `classifier_score`.

> **Measured caveat.** This layer does *not* improve detection: +0.0050 accuracy over
> Vision-Only on four discordant images, McNemar p = 0.6250, AUC moving the other way
> (ADR 0005). It is in the system because the explanation needs a single number to
> account for, not because it detects better.

---

## 5. Frontend phase machine

`App.jsx` holds one `phase` string; each screen is a render branch off it.

```mermaid
stateDiagram-v2
    [*] --> idle

    idle --> crop: file chosen for cropping
    idle --> analyzing: file used as-is
    idle --> camera: use camera
    idle --> compare_pick: compare two photos

    crop --> analyzing: use this crop
    crop --> idle: cancel

    camera --> review: shutter
    camera --> camera_blocked: permission denied
    review --> analyzing: use this photo
    review --> camera: retake

    compare_pick --> analyzing: analyse both

    analyzing --> face_pick: /detect found >1 face
    face_pick --> analyzing: face chosen
    analyzing --> verdict: single Analysis
    analyzing --> comparing: a Held Analysis exists
    analyzing --> problem: no_face / unreachable / server / aborted

    verdict --> idle: start over
    verdict --> idle: hold for comparison
    comparing --> idle: done
    problem --> idle: try again

    note right of verdict
        Explanation Register: Plain ⇄ Technical
        Technical is measurements, not a
        second generated paragraph (ADR 0010)
    end note
```

---

## 6. Offline evaluation

Two independent axes that share no code, no data and no metrics — never call either one
"the evaluation" without qualifying it.

```mermaid
flowchart LR
    subgraph data["Data"]
        DS[("data/deepfake_faces/<br/>16,060 real + 16,060 fake")]
        MAN["results/split_manifest.json<br/>seeded shuffle, recovered · ADR 0001"]
        LF["leakage-free subset<br/>2,799 of 3,212 · ADR 0004"]
        DS --> MAN --> LF
    end

    subgraph det["Axis 1 — Detection Metrics"]
        EV["evaluate.py"]
        AB["evaluate_ablation.py<br/>--n 400"]
        ARMS["Vision-Only 0.9775<br/>LLM-Only 0.6625 (blind · ADR 0003)<br/>Fused 0.9825 · p = 0.6250 n.s."]
        EV --> ACC["accuracy 0.9750<br/>AUC 0.9973"]
        AB --> ARMS
    end

    subgraph exp["Axis 2 — Explanation Quality"]
        CORP["build_explanation_corpus.py"]
        AUTO["evaluate_explanations.py<br/>ROUGE-1 0.3554 · distinct-1 0.0203"]
        JR["run_judge_eval.py → IJudge<br/>temp 0 · schema JSON · cached"]
        INF["run_informed_pipeline.py<br/>compare_informed.py"]
        PAIR["blind vs informed, paired sign test<br/>fake +0.91 p = 0.0015 · real −0.02 n.s."]
        CORP --> AUTO
        CORP --> JR --> PAIR
        INF --> PAIR
    end

    LF --> EV & AB
    AB -- "372 generated explanations" --> CORP
    ACC & ARMS & AUTO & PAIR --> REP["report_results.py<br/>→ results/RESULTS.md"]
```

The judge that produced the reported scores was the **on-device** implementation — the
same Qwen3-VL-2B weights that wrote the explanations, because no `GEMINI_API_KEY` was
configured. Treat its absolute means as an optimistic bound (ADR 0007); the paired
blind-vs-informed difference is the trustworthy part, since one judge grades both arms.

---

## Where the numbers come from

| Figure in these diagrams | Source |
|---|---|
| 224×224 crop, buffalo_l, det_size 640 | `backend/app/preprocessing/face_pipeline.py` |
| 805 MiB CUDA provider cost, CPU default | `.env.example`, ADR 0011 |
| 0.55 / 0.45 weights, field semantics | `backend/app/fusion/fusion.py` |
| 3 attempts, 512 new tokens, sampling on retry | `backend/app/llm/reasoner.py` |
| 15–90 s, `elapsed_seconds`, `faces_found` | `backend/app/pipeline.py` |
| Accuracy, AUC, ablation, ROUGE, judge means | `results/RESULTS.md` |
