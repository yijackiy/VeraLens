"""
Turn the ablation run's per-image records into the judge's input corpus.

`scripts/evaluate_ablation.py` already generated a real explanation for every
image it scored, so the corpus steps 4.3 and 4.4 need is a reformat, not a
second VLM run.

Ground-truth signals
--------------------
The dataset carries real/fake labels and nothing else: no artefact-level
annotation saying *which* forensic trace is present in a given fake. So there
is no honest per-image signal list to hand the judge.

What is known per image is the label, and that is what the corpus asserts:

  real  the image is authentic, so the correct explanation reports no
        manipulation artefacts. An explanation naming artefacts here is wrong,
        and the judge can see that.
  fake  the image is manipulated, but which artefact betrays it is not
        annotated. The corpus says exactly that rather than inventing a list.

The judge therefore grades whether an explanation is consistent with the known
label and forensically plausible — not whether it named the specific artefact.
That is a weaker claim than the build guide assumed, and the write-up must say
so. See docs/adr/0006.

Usage:
    python scripts/build_explanation_corpus.py
"""

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)

RECORDS = os.path.join("results", "ablation_records.jsonl")
OUT = os.path.join("data", "eval", "explanations.jsonl")

GROUND_TRUTH = {
    "real": ["none - authentic photograph, no manipulation artefacts present"],
    "fake": ["face manipulation present - the specific artefact type is not "
             "annotated in this dataset"],
}


def main():
    if not os.path.exists(RECORDS):
        sys.exit(f"{RECORDS} not found - run scripts/evaluate_ablation.py first.")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    written = skipped = 0
    seen = set()
    with open(RECORDS, encoding="utf-8") as src, \
            open(OUT, "w", encoding="utf-8") as dst:
        for line in src:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "explanation" not in row or "true_class" not in row:
                continue

            explanation = (row.get("explanation") or "").strip()
            # A parse failure left a placeholder, not an explanation. Judging it
            # would score the failure handling, not the reasoning layer.
            if not explanation or row.get("llm_verdict") == "unknown":
                skipped += 1
                continue

            sample_id = os.path.splitext(os.path.basename(row["path"]))[0]
            sample_id = f"{row['true_class']}_{sample_id}"
            if sample_id in seen:
                continue
            seen.add(sample_id)

            dst.write(json.dumps({
                "sample_id": sample_id,
                "explanation": explanation,
                "ground_truth_signals": GROUND_TRUTH[row["true_class"]],
                "true_class": row["true_class"],
                "llm_verdict": row["llm_verdict"],
            }) + "\n")
            written += 1

    print(f"Wrote {written} explanations to {OUT}")
    print(f"Skipped {skipped} records with unparseable verdicts "
          f"(no explanation to grade)")


if __name__ == "__main__":
    main()
