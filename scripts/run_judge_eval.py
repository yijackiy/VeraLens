"""
Step 4.4 — batch judge run over a set of generated explanations.

Offline batch job, NOT part of the inference path.

Input is JSONL, one record per line:
    {"sample_id": "...", "explanation": "...", "ground_truth_signals": [...]}

Usage:
    python scripts/run_judge_eval.py data/eval/explanations.jsonl
    python scripts/run_judge_eval.py --summary        # just print the table stats
    python scripts/run_judge_eval.py --dry-run <file> # parse input, no API calls

Re-running the same file makes zero API calls: every score is cached on
hash(rubric + input + model + temperature).
"""

import argparse
import json
import os
import sys

# Allow running from the veralens/ root with `python scripts/...`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.eval import storage
from backend.app.eval.runner import score_many


def load_samples(path: str):
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{lineno}: invalid JSON — {exc}")
            missing = {"sample_id", "explanation"} - rec.keys()
            if missing:
                raise SystemExit(f"{path}:{lineno}: missing keys {sorted(missing)}")
            yield (str(rec["sample_id"]),
                   rec["explanation"],
                   rec.get("ground_truth_signals", []))


def main():
    parser = argparse.ArgumentParser(description="Run the LLM judge over explanations.")
    parser.add_argument("input", nargs="?", help="JSONL file of explanations")
    parser.add_argument("--summary", action="store_true",
                        help="print judge_scores stats and exit")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate the input file without calling the judge")
    args = parser.parse_args()

    if args.summary:
        storage.get_engine()
        print(json.dumps(storage.summary(), indent=2))
        return

    if not args.input:
        parser.error("an input JSONL file is required (or use --summary)")

    samples = list(load_samples(args.input))
    print(f"[judge] {len(samples)} samples from {args.input}")

    if args.dry_run:
        print("[judge] dry run — input is valid, no API calls made")
        return

    result = score_many(samples)

    print("\n--- run summary ---")
    print(f"new API calls : {result['new_calls']}")
    print(f"cache hits    : {result['cache_hits']}")
    print(f"failures      : {result['failures']}")
    print("\n--- judge_scores table ---")
    print(f"rows          : {result['total_rows']}")
    print(f"scored        : {result['scored']}")
    # Report this number in the thesis alongside the mean — failed calls are
    # excluded from the aggregate, so the reader needs to know how many there were.
    print(f"failed        : {result['failed']}")
    print(f"mean score    : {result['mean_score']}")


if __name__ == "__main__":
    main()
