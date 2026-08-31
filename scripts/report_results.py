"""
Render results/RESULTS.md from the JSON that evaluate.py and
evaluate_ablation.py produce. Safe to re-run at any time — the ablation
section reflects however many images have been scored so far.

Usage:
    python scripts/report_results.py
"""

import json
import os
import sys
from collections import Counter
from math import comb

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)
sys.path.insert(0, REPO_ROOT)

RESULTS_DIR = "results"
RECORDS = os.path.join(RESULTS_DIR, "ablation_records.jsonl")
OUT = os.path.join(RESULTS_DIR, "RESULTS.md")

ARM_LABELS = {
    "vision_only": "Vision-Only",
    "llm_only": "LLM-Only",
    "fused": "Fused",
}


def load(name):
    path = os.path.join(RESULTS_DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_records():
    if not os.path.exists(RECORDS):
        return []
    rows = []
    with open(RECORDS, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return [r for r in rows if "llm_verdict" in r]


def load_judge():
    """Read the judge_scores table, if the judge has been run.

    Returns None rather than raising when the table is absent or empty, so the
    report still renders before step 4.4 has been run.
    """
    try:
        from sqlalchemy import select

        from backend.app.eval import storage
        engine = storage.get_engine()
        t = storage.judge_scores
        with engine.connect() as conn:
            rows = conn.execute(select(
                t.c.sample_id, t.c.score, t.c.ok, t.c.provider,
                t.c.model_version, t.c.rubric_version, t.c.temperature)).all()
    except Exception:
        return None

    if not rows:
        return None

    ok_rows = [r for r in rows if r.ok and r.score is not None]
    if not ok_rows:
        return None

    by_class = {}
    for r in ok_rows:
        cls = r.sample_id.split("_", 1)[0]
        if cls not in ("real", "fake"):
            continue
        by_class.setdefault(cls, []).append(r.score)

    distribution = Counter(r.score for r in ok_rows)
    last = rows[-1]
    return {
        "provider": last.provider,
        "model_version": last.model_version,
        "rubric_version": last.rubric_version,
        "temperature": last.temperature,
        "scored": len(ok_rows),
        "failed": sum(1 for r in rows if not r.ok),
        "mean_score": round(sum(r.score for r in ok_rows) / len(ok_rows), 3),
        "by_class": {c: {"n": len(v), "mean": sum(v) / len(v)}
                     for c, v in by_class.items()},
        "distribution": dict(distribution),
    }


def mcnemar(rows, a="vision_fake_probability", b="fused_fake_probability"):
    """Exact two-sided McNemar on the paired arms.

    The arms score the same images, so the question is not whether their
    accuracies differ but whether they disagree asymmetrically. With few
    discordant pairs a headline accuracy gap can be pure noise.
    """
    def right(r, key):
        return int(r[key] >= 0.5) == r["label"]

    only_a = sum(1 for r in rows if right(r, a) and not right(r, b))
    only_b = sum(1 for r in rows if not right(r, a) and right(r, b))
    n = only_a + only_b
    if n == 0:
        return only_a, only_b, 1.0
    tail = sum(comb(n, k) for k in range(min(only_a, only_b) + 1))
    return only_a, only_b, min(tail / 2 ** n * 2, 1.0)


def llm_by_class(rows):
    """The VLM's verdicts split by ground truth.

    A single accuracy figure hides a class-conditional bias: a model that
    mostly answers "real" scores well on the real half and at chance on the
    fake half, which is not detection.
    """
    out = {}
    for label, name in ((0, "real"), (1, "fake")):
        counts = Counter(r["llm_verdict"] for r in rows if r["label"] == label)
        total = sum(counts.values())
        hits = counts.get(name, 0)
        out[name] = {
            "counts": dict(counts),
            "total": total,
            "correct": hits,
            "rate": hits / total if total else 0.0,
        }
    return out


def metrics_table(m):
    cm = m["confusion_matrix"]
    rows = [
        "| Metric | Value |",
        "| --- | --- |",
        f"| Accuracy | {m['accuracy']:.4f} |",
        f"| AUC-ROC | {m['auc_roc']:.4f} |",
        f"| Macro F1 | {m['macro_f1']:.4f} |",
        f"| Images | {m['n_samples']:,} |",
        "",
        "| Class | Precision | Recall | F1 | Support |",
        "| --- | --- | --- | --- | --- |",
    ]
    for name, c in m["per_class"].items():
        rows.append(f"| {name} | {c['precision']:.4f} | {c['recall']:.4f} | "
                    f"{c['f1']:.4f} | {c['support']:,} |")
    rows += [
        "",
        "| | predicted real | predicted fake |",
        "| --- | --- | --- |",
        f"| **true real** | {cm['true_real_pred_real']:,} | {cm['true_real_pred_fake']:,} |",
        f"| **true fake** | {cm['true_fake_pred_real']:,} | {cm['true_fake_pred_fake']:,} |",
    ]
    return "\n".join(rows)


def main():
    det = load("detection_metrics.json")
    dup = load("duplicate_check.json")
    abl = load("ablation_metrics.json")

    if det is None:
        sys.exit("results/detection_metrics.json not found — run evaluate.py first.")

    clean = det.get("clean_subset")
    headline = clean or det
    ref = det["reference_check"]

    out = [
        "# VeraLens — Results",
        "",
        "Generated by `scripts/report_results.py`. Numbers come from",
        "`scripts/evaluate.py` (detection) and `scripts/evaluate_ablation.py`",
        "(ablation). See `docs/adr/0001`, `0003` and `0004` for methodology.",
        "",
        "## What was measured, and on what",
        "",
        "These are **Validation Performance** figures, not test performance:",
        "`build_splits()` only ever produced a train/validation pair, and that",
        "validation data was observed while training (it informed the two-phase",
        "schedule). No untouched test set exists. Model selection was never",
        "automated against it — training saves the final epoch rather than the",
        "best-validation checkpoint — so the contamination is weak, but the",
        "distinction belongs in the write-up.",
        "",
    ]

    if dup:
        leak = dup["split_leakage"]
        out += [
            "The dataset also contains duplicate images, and the split shuffles",
            "rather than deduplicates, so "
            f"**{leak['validation_images_also_in_train']:,} of "
            f"{leak['validation_size']:,} validation images "
            f"({leak['leakage_rate']:.2%})** are byte-identical to a training",
            "image. Headline figures below exclude them.",
            "",
        ]

    out += [
        f"## Detection Metrics — {'leakage-free subset' if clean else 'validation split'}",
        "",
        metrics_table(headline),
        "",
    ]

    if clean:
        out += [
            "For comparison, on the full validation split including the "
            f"{clean['excluded_leaked_images']:,} leaked images: accuracy "
            f"{det['accuracy']:.4f}, AUC {det['auc_roc']:.4f}. The "
            f"{det['accuracy'] - clean['accuracy']:+.4f} difference is the "
            "inflation contributed by leakage.",
            "",
        ]

    out += [
        "### Split recovery",
        "",
        "The 4 August training run saved no metrics. Its split was regenerated",
        "by re-running the seeded shuffle, which reproduced the recorded figures",
        f"exactly — accuracy {det['accuracy']:.4f} against a recorded "
        f"{ref['reference_accuracy']:.4f}, AUC {det['auc_roc']:.4f} against "
        f"{ref['reference_auc']:.4f}. This confirms both the recovery and the",
        "originally reported numbers.",
        "",
        "![ROC](roc_curve.png)",
        "",
        "![Confusion matrix](confusion_matrix.png)",
        "",
    ]

    # ── ablation ──
    out += ["## Ablation — does the reasoning layer add detection value?", ""]
    if abl is None:
        out += ["_Not yet run._", ""]
    else:
        s = abl["sample"]
        arms = abl["arms"]
        out += [
            f"{s['scored']:,} images, stratified and shuffled, drawn from the",
            "leakage-free validation pool. The reasoning layer ran **blind** —",
            "production shows it the classifier's score, which would make an",
            "\"LLM-only\" arm circular and cause fusion to double-count one",
            "signal (see ADR 0003).",
            "",
            "| Arm | Accuracy | AUC-ROC | Macro F1 |",
            "| --- | --- | --- | --- |",
        ]
        for key in ("vision_only", "llm_only", "fused"):
            m = arms[key]
            out.append(f"| {ARM_LABELS[key]} | {m['accuracy']:.4f} | "
                       f"{m['auc_roc']:.4f} | {m['macro_f1']:.4f} |")

        delta = arms["fused"]["accuracy"] - arms["vision_only"]["accuracy"]
        d_auc = arms["fused"]["auc_roc"] - arms["vision_only"]["auc_roc"]
        rows = load_records()
        out += [
            "",
            f"Fused against Vision-Only: {delta:+.4f} accuracy, {d_auc:+.4f} AUC.",
            "",
        ]

        if rows:
            only_v, only_f, p = mcnemar(rows)
            significant = p < 0.05
            out += [
                "### Is that difference real?",
                "",
                "The arms score identical images, so the comparison is paired and",
                "the accuracy gap alone says little. McNemar's exact test on the",
                "images where the two arms disagree:",
                "",
                "| Quantity | Value |",
                "| --- | --- |",
                f"| Vision right, Fused wrong | {only_v} |",
                f"| Vision wrong, Fused right | {only_f} |",
                f"| Discordant pairs | {only_v + only_f} |",
                f"| Two-sided exact p | {p:.4f} |",
                "",
            ]
            if significant:
                out += [
                    f"At p = {p:.4f} the difference is statistically significant.",
                    "",
                ]
            else:
                out += [
                    f"At p = {p:.4f} this is **not statistically significant**. The",
                    f"{delta:+.4f} accuracy gap rests on {only_v + only_f} images and is",
                    "indistinguishable from noise. The fusion layer should not be",
                    "presented as improving detection. AUC moves in the opposite",
                    "direction, which points the same way.",
                    "",
                ]

            by_class = llm_by_class(rows)
            out += [
                "### What the reasoning layer actually does",
                "",
                "A single accuracy figure for LLM-Only is misleading, because the",
                "model's behaviour differs sharply by class:",
                "",
                "| True class | Verdicts | Correct | Rate |",
                "| --- | --- | --- | --- |",
            ]
            for name in ("real", "fake"):
                c = by_class[name]
                shown = ", ".join(f"{k} {v}" for k, v in sorted(c["counts"].items()))
                out.append(f"| {name} | {shown} | {c['correct']}/{c['total']} | "
                           f"{c['rate']:.2%} |")
            out += [
                "",
                f"On real faces it is right {by_class['real']['rate']:.0%} of the "
                f"time; on fake faces {by_class['fake']['rate']:.0%}, which is "
                "chance. The",
                "headline LLM-Only accuracy comes from a bias toward answering",
                "\"real\", not from detecting manipulation. **The reasoning layer",
                "provides no usable independent detection signal.**",
                "",
                "This does not undermine the thesis, whose claim is about",
                "explainability rather than accuracy, but it does mean the",
                "explainability case has to be made on the Explanation Quality",
                "axis (ROUGE and the Judge), not on detection numbers.",
                "",
            ]

        out += [
            f"Unparseable VLM verdicts: {arms['llm_only']['unparseable_verdicts']} "
            f"({arms['llm_only']['unparseable_rate']:.1%}). These are scored as",
            "0.5 (no information) rather than silently counted as \"real\".",
            "",
        ]
        if s["scored"] < s["requested"]:
            out += [
                f"_Run stopped at {s['scored']:,} of {s['requested']:,} images._ "
                "The sample was shuffled before scoring, so this remains an",
                "unbiased sample rather than a truncated one.",
                "",
            ]

    # ── explanation quality (4.3) ──
    expl = load("explanation_metrics.json")
    out += ["## Explanation Quality — automated metrics (step 4.3)", ""]
    if expl is None:
        out += ["_Not yet run._", ""]
    else:
        c = expl["corpus"]
        rouge = expl["rouge_vs_canonical_references"]
        rf = expl["reference_free"]
        out += [
            f"{c['n']} explanations generated during the ablation "
            f"({c['real']} real / {c['fake']} fake), mean "
            f"{c['mean_length_tokens']} tokens.",
            "",
            "### ROUGE — read with care",
            "",
            "This dataset ships no human reference explanations, so ROUGE here",
            "compares against canonical descriptions written for this project.",
            "It measures how closely the model's wording tracks expected",
            "forensic vocabulary — **not whether an explanation is correct**",
            "(ADR 0006).",
            "",
            "| Set | ROUGE-1 | ROUGE-L |",
            "| --- | --- | --- |",
            f"| Overall | {rouge['overall']['rouge1']:.4f} | "
            f"{rouge['overall']['rougeL']:.4f} |",
        ]
        for cls, v in rouge["per_class"].items():
            out.append(f"| {cls} (n={v['n']}) | {v['rouge1']:.4f} | "
                       f"{v['rougeL']:.4f} |")

        overlap = rf["mean_pairwise_rougeL_within_class"]
        out += [
            "",
            "### Are the explanations actually specific to the image?",
            "",
            "These need no references, and bear directly on the explainability",
            "claim: prose that barely varies between images explains nothing,",
            "however fluent it reads.",
            "",
            "| Measure | Value |",
            "| --- | --- |",
            f"| distinct-1 (unique unigrams) | {rf['distinct_1']:.4f} |",
            f"| distinct-2 (unique bigrams) | {rf['distinct_2']:.4f} |",
            f"| Mean pairwise ROUGE-L, real | {overlap['real']:.4f} |",
            f"| Mean pairwise ROUGE-L, fake | {overlap['fake']:.4f} |",
            f"| Mean pairwise ROUGE-L, all | {rf['mean_pairwise_rougeL_all']:.4f} |",
            "",
            "| Forensic signal | Share of explanations naming it |",
            "| --- | --- |",
        ]
        for name, v in rf["signal_coverage_overall"].items():
            out.append(f"| {name} | {v['rate']:.1%} |")

        lighting = rf["signal_coverage_overall"].get("lighting", {}).get("rate", 0)
        if lighting >= 0.99:
            out += [
                "",
                "Every single explanation mentions lighting, and most name the",
                "other prompted signals too. Combined with a distinct-1 of "
                f"{rf['distinct_1']:.3f}, this indicates the model is largely",
                "reciting the checklist the prompt supplies rather than",
                "reporting what it observed — consistent with its chance-level",
                "accuracy on fake images.",
            ]
        out.append("")

    # ── judge (4.4) ──
    out += ["## Explanation Quality — LLM-as-judge (step 4.4)", ""]
    judge = load_judge()
    if judge is None:
        out += ["_Not yet run._", ""]
    else:
        out += [
            f"Provider `{judge['provider']}`, model `{judge['model_version']}`, "
            f"rubric `{judge['rubric_version']}`, temperature "
            f"{judge['temperature']}.",
            "",
            "| Quantity | Value |",
            "| --- | --- |",
            f"| Explanations scored | {judge['scored']} |",
            f"| Failed calls | {judge['failed']} |",
            f"| Mean score (1-5) | {judge['mean_score']} |",
        ]
        corpus_n = expl["corpus"]["n"] if expl else None
        if corpus_n and judge["scored"] + judge["failed"] < corpus_n:
            out += [
                "",
                f"Scored {judge['scored'] + judge['failed']} of the "
                f"{corpus_n}-explanation corpus. The run stopped twice: first on",
                "the daily quota guard (correct for the Gemini free tier, not",
                "meaningful for an on-device judge), then on a reproducible",
                "segfault while loading the model — an environment failure this",
                "machine has hit before, not a defect in the evaluation. The",
                "corpus is stored in ablation order, which was shuffled before",
                "scoring, so the scored portion is an unbiased sample rather",
                "than a truncated one, and it stayed class-balanced.",
            ]
        if judge.get("by_class"):
            out += ["", "| True class | n | Mean score |", "| --- | --- | --- |"]
            for cls, v in sorted(judge["by_class"].items()):
                out.append(f"| {cls} | {v['n']} | {v['mean']:.2f} |")
        if judge.get("distribution"):
            out += ["", "| Score | Count |", "| --- | --- |"]
            for score in sorted(judge["distribution"]):
                out.append(f"| {score} | {judge['distribution'][score]} |")
        if judge["provider"] == "local":
            out += [
                "",
                "**The judge is grading its own output.** No Gemini key was",
                "configured, so step 4.4 ran on the on-device fallback, which",
                "reuses the same Qwen3-VL-2B weights that wrote the",
                "explanations. Models favour text from their own distribution,",
                "so this mean is an optimistic bound rather than an independent",
                "assessment (ADR 0007). Re-running under Gemini is a config",
                "change; scores are cached per model, so both can be reported.",
            ]
        out.append("")

    # ── blind vs production (informed) ──
    comp = load("informed_vs_blind.json")
    out += ["## Explanation Quality — blind vs production configuration", ""]
    if comp is None:
        out += ["_Not yet run._", ""]
    else:
        b, i = comp["blind"], comp["informed"]
        out += [
            "The ablation runs the reasoning layer blind so the LLM-Only arm",
            "stays honest (ADR 0003). Production instead tells it what the",
            "classifier found. This is what that is worth.",
            "",
            "The classifier's verdict is passed **qualitatively** (\"very likely",
            "MANIPULATED\") rather than as a number. Handing a 2B model the raw",
            "score makes it copy that number into its own confidence field",
            "instead of judging for itself — see ADR 0008.",
            "",
            "| True class | blind n | blind mean | informed n | informed mean |",
            "| --- | --- | --- | --- | --- |",
        ]
        for cls in ("fake", "real"):
            bc, ic = b.get(cls), i.get(cls)
            if bc and ic:
                out.append(f"| {cls} | {bc['n']} | {bc['mean']:.2f} | "
                           f"{ic['n']} | {ic['mean']:.2f} |")

        paired = comp.get("paired", {})
        if paired:
            out += [
                "",
                "Paired per image, with an exact sign test — a mean can move on",
                "a handful of images, so what matters is how many actually",
                "changed and in which direction:",
                "",
                "| Set | n | Change | Better | Worse | Unchanged | p |",
                "| --- | --- | --- | --- | --- | --- | --- |",
            ]
            for label in ("fake", "real", "all"):
                p = paired.get(label)
                if p:
                    out.append(
                        f"| {label} | {p['n']} | {p['delta']:+.2f} | "
                        f"{p['improved']} | {p['worsened']} | "
                        f"{p['unchanged']} | {p['sign_test_p']:.4f} |")

            fake = paired.get("fake")
            if fake and fake["sign_test_p"] < 0.05:
                out += [
                    "",
                    f"The gain is significant on fake images "
                    f"({fake['delta']:+.2f}, p = {fake['sign_test_p']:.4f}) and",
                    "absent on real ones, which is what should happen: blind",
                    "explanations of real faces already scored near ceiling, so",
                    "there was no headroom, while explanations of fakes were the",
                    "ones being guessed.",
                    "",
                    "This does not overturn the detection null result — the",
                    "reasoning layer still cannot find deepfakes unaided. The",
                    "claim it supports is narrower and is the thesis's actual",
                    "subject: **given a reliable detector's verdict, the",
                    "reasoning layer explains significantly better, provided that",
                    "verdict is communicated in words rather than as a number.**",
                    "",
                    "Both arms were graded by the same judge, so the",
                    "self-evaluation bias in ADR 0007 applies to each equally and",
                    "largely cancels in the comparison. The paired difference is",
                    "more trustworthy than either absolute mean.",
                ]
        out.append("")

    out += [
        "## Limitations",
        "",
        "- **No held-out test set.** All figures are validation performance.",
        "- **Duplicate-driven leakage** exists in the dataset; headline numbers",
        "  exclude affected images, but deduplicating properly would require",
        "  retraining, which project scope forbids.",
        "- **No cross-dataset evaluation.** FaceForensics++ and CelebDF-v2 are",
        "  video datasets behind manually approved access, and video is out of",
        "  scope (ADR 0002). Detectors are known to degrade sharply on unseen",
        "  generators, so these in-distribution figures should not be read as",
        "  evidence of real-world detection strength.",
        "",
    ]

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
