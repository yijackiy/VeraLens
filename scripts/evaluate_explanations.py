"""
Step 4.3 — automated Explanation Quality metrics.

Two families of metric, because one of them is much weaker than the build
guide assumed.

ROUGE (reference-based) — read with care
----------------------------------------
ROUGE compares generated text against human reference explanations. This
dataset has none: it carries real/fake labels and no written forensic
descriptions. The references used here are canonical descriptions written for
this project, not ground truth, so ROUGE measures how closely the VLM's wording
tracks the expected forensic vocabulary. It does NOT measure whether an
explanation is correct. Reported because step 4.3 asks for it, and captioned
with that limitation everywhere it appears.

Reference-free — the metrics that actually bear on the thesis
-------------------------------------------------------------
If the reasoning layer emits near-identical prose regardless of the image, it
explains nothing regardless of how fluent it sounds. These need no references
and speak directly to the explainability claim:

  distinct-1/2   vocabulary diversity across the corpus
  self-overlap   mean pairwise ROUGE-L within a class; high means boilerplate
  signal coverage how often each forensic signal the prompt asks about is named
  discrimination whether real and fake explanations differ from each other

Usage:
    python scripts/evaluate_explanations.py
"""

import json
import os
import random
import sys
from collections import Counter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from rouge_score import rouge_scorer

CORPUS = os.path.join("data", "eval", "explanations.jsonl")
OUT = os.path.join("results", "explanation_metrics.json")
PAIR_SAMPLE = 3000
SEED = 42

# Canonical references. NOT ground truth - see the module docstring.
REFERENCES = {
    "fake": [
        "The hairline boundary is inconsistent and shows an abrupt texture "
        "change where the face has been blended onto the head.",
        "Skin texture is unnaturally smooth with absent pores, the eye "
        "highlights are asymmetric, and lighting direction disagrees between "
        "the face and the background.",
        "Edge blending around the face contour is visible, indicating the "
        "face region was composited from another source.",
    ],
    "real": [
        "Skin texture shows natural pores and fine detail, lighting direction "
        "is consistent across the face and background, and the hairline "
        "boundary is continuous.",
        "Eye highlights are symmetric and consistent with a single light "
        "source, and there is no visible blending or compositing at the face "
        "contour.",
        "The image shows no artefacts of synthetic generation; texture, "
        "lighting and edges are all consistent with an authentic photograph.",
    ],
}

# The signals FORENSIC_PROMPT explicitly asks the model to examine.
SIGNAL_TERMS = {
    "hairline": ["hairline", "hair line", "hair boundary"],
    "eye highlights": ["eye highlight", "eye reflection", "catchlight", "eye symmetry"],
    "skin texture": ["skin texture", "pore", "skin detail", "smooth skin"],
    "lighting": ["lighting", "light direction", "illumination", "shadow"],
    "edge blending": ["edge blend", "blending", "face contour", "composit", "seam"],
}


def tokens(text):
    return [t for t in "".join(
        c.lower() if c.isalnum() or c.isspace() else " " for c in text).split() if t]


def ngrams(toks, n):
    return [tuple(toks[i:i + n]) for i in range(len(toks) - n + 1)]


def distinct_n(texts, n):
    """Unique n-grams as a fraction of all n-grams. Low means repetitive."""
    all_ng = []
    for t in texts:
        all_ng.extend(ngrams(tokens(t), n))
    if not all_ng:
        return 0.0
    return len(set(all_ng)) / len(all_ng)


def mean_pairwise_rougeL(texts, scorer, sample=PAIR_SAMPLE, seed=SEED):
    """Average ROUGE-L between explanations of the same class.

    This is a templatedness measure: if every explanation says the same thing,
    pairs overlap heavily and the reasoning layer is producing boilerplate.
    """
    if len(texts) < 2:
        return None
    rng = random.Random(seed)
    total = count = 0.0
    for _ in range(sample):
        a, b = rng.sample(range(len(texts)), 2)
        total += scorer.score(texts[a], texts[b])["rougeL"].fmeasure
        count += 1
    return total / count


def best_reference_rouge(text, refs, scorer):
    """Max ROUGE over the available references (standard multi-reference ROUGE)."""
    best = {"rouge1": 0.0, "rougeL": 0.0}
    for ref in refs:
        s = scorer.score(ref, text)
        best["rouge1"] = max(best["rouge1"], s["rouge1"].fmeasure)
        best["rougeL"] = max(best["rougeL"], s["rougeL"].fmeasure)
    return best


def signal_coverage(texts):
    out = {}
    for name, variants in SIGNAL_TERMS.items():
        hits = sum(1 for t in texts
                   if any(v in t.lower() for v in variants))
        out[name] = {"mentions": hits,
                     "rate": round(hits / len(texts), 4) if texts else 0.0}
    return out


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def main():
    if not os.path.exists(CORPUS):
        sys.exit(f"{CORPUS} not found - run scripts/build_explanation_corpus.py first.")

    rows = []
    with open(CORPUS, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if not rows:
        sys.exit("corpus is empty")

    scorer = rouge_scorer.RougeScorer(["rouge1", "rougeL"], use_stemmer=True)
    by_class = {"real": [], "fake": []}
    for r in rows:
        by_class[r["true_class"]].append(r)

    print(f"Scoring {len(rows)} explanations "
          f"({len(by_class['real'])} real / {len(by_class['fake'])} fake)...")

    # ── reference-based ──
    per_class_rouge = {}
    for cls, items in by_class.items():
        scores = [best_reference_rouge(r["explanation"], REFERENCES[cls], scorer)
                  for r in items]
        per_class_rouge[cls] = {
            "rouge1": round(mean([s["rouge1"] for s in scores]), 4),
            "rougeL": round(mean([s["rougeL"] for s in scores]), 4),
            "n": len(items),
        }

    all_scores = []
    for cls, items in by_class.items():
        all_scores += [best_reference_rouge(r["explanation"], REFERENCES[cls], scorer)
                       for r in items]
    overall_rouge = {
        "rouge1": round(mean([s["rouge1"] for s in all_scores]), 4),
        "rougeL": round(mean([s["rougeL"] for s in all_scores]), 4),
    }

    # ── reference-free ──
    texts = [r["explanation"] for r in rows]
    lengths = [len(tokens(t)) for t in texts]

    templatedness = {}
    for cls, items in by_class.items():
        val = mean_pairwise_rougeL([r["explanation"] for r in items], scorer)
        templatedness[cls] = round(val, 4) if val is not None else None

    cross = mean_pairwise_rougeL(texts, scorer)

    payload = {
        "corpus": {
            "n": len(rows),
            "real": len(by_class["real"]),
            "fake": len(by_class["fake"]),
            "mean_length_tokens": round(mean(lengths), 1),
            "min_length_tokens": min(lengths),
            "max_length_tokens": max(lengths),
        },
        "rouge_vs_canonical_references": {
            "caveat": "References are canonical descriptions written for this "
                      "project, not human ground truth - this dataset has no "
                      "reference explanations. Measures vocabulary alignment, "
                      "not correctness.",
            "overall": overall_rouge,
            "per_class": per_class_rouge,
        },
        "reference_free": {
            "distinct_1": round(distinct_n(texts, 1), 4),
            "distinct_2": round(distinct_n(texts, 2), 4),
            "mean_pairwise_rougeL_within_class": templatedness,
            "mean_pairwise_rougeL_all": round(cross, 4) if cross else None,
            "signal_coverage_overall": signal_coverage(texts),
            "signal_coverage_by_class": {
                cls: signal_coverage([r["explanation"] for r in items])
                for cls, items in by_class.items()
            },
        },
    }

    os.makedirs("results", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    # ── summary ──
    c = payload["corpus"]
    print("\n" + "=" * 64)
    print("EXPLANATION QUALITY - automated metrics (step 4.3)")
    print("=" * 64)
    print(f"  Corpus           {c['n']} explanations, mean "
          f"{c['mean_length_tokens']} tokens "
          f"(range {c['min_length_tokens']}-{c['max_length_tokens']})")
    print(f"\n  ROUGE vs canonical references (vocabulary alignment, NOT correctness)")
    print(f"    overall        R1 {overall_rouge['rouge1']:.4f}   "
          f"RL {overall_rouge['rougeL']:.4f}")
    for cls, v in per_class_rouge.items():
        print(f"    {cls:<14} R1 {v['rouge1']:.4f}   RL {v['rougeL']:.4f}  "
              f"(n={v['n']})")

    rf = payload["reference_free"]
    print(f"\n  Diversity")
    print(f"    distinct-1     {rf['distinct_1']:.4f}")
    print(f"    distinct-2     {rf['distinct_2']:.4f}")
    print(f"    self-overlap   real {templatedness['real']:.4f}  "
          f"fake {templatedness['fake']:.4f}  all {rf['mean_pairwise_rougeL_all']:.4f}")
    if max(v for v in templatedness.values() if v is not None) > 0.5:
        print("    HIGH self-overlap: explanations are largely boilerplate.")

    print(f"\n  Forensic signal coverage (share of explanations naming each)")
    for name, v in rf["signal_coverage_overall"].items():
        print(f"    {name:<15} {v['rate']:.1%}")
    print("=" * 64)
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
