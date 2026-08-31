"""
Overnight driver: generate production-mode explanations, then judge them.

Measures the configuration you actually ship. `evaluate_ablation.py` runs the
VLM blind so the LLM-Only arm stays honest (ADR 0003), but production hands it
the classifier's score. Since a correct verdict scores 3.33 against 1.05 for a
wrong one, and the classifier is right 97.5% of the time, the deployed system
almost certainly explains better than the blind measurement suggests — this
run finds out by how much.

Three steps, in order:
  1. scripts/evaluate_ablation.py --informed   generate explanations
  2. scripts/build_explanation_corpus.py --informed
  3. scripts/run_judge_eval.py                 score them

Built to survive a bad night. This machine intermittently segfaults while
loading Qwen3-VL, so if step 1 dies partway the driver still runs 2 and 3 over
whatever was written: every finished image is on disk, and the sample was
shuffled before scoring, so a partial run is a valid smaller sample rather
than a truncated one.

Usage:
    python scripts/run_informed_pipeline.py            # 200 images
    python scripts/run_informed_pipeline.py --n 100
"""

import argparse
import os
import subprocess
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)

PYTHON = sys.executable
RECORDS = os.path.join("results", "ablation_records_informed.jsonl")
CORPUS = os.path.join("data", "eval", "explanations_informed.jsonl")


def run(label, cmd, env=None):
    print(f"\n{'=' * 66}\n{label}\n{'=' * 66}", flush=True)
    merged = {**os.environ, **(env or {})}
    started = time.time()
    code = subprocess.call(cmd, env=merged)
    mins = (time.time() - started) / 60
    print(f"\n[{label}] exit={code} after {mins:.1f} min", flush=True)
    return code


def count_lines(path):
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as fh:
        return sum(1 for line in fh if line.strip())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=200,
                    help="images to generate explanations for (default 200)")
    args = ap.parse_args()

    started = time.time()

    # ── 1. generate ──
    code = run("STEP 1/3  generate production-mode explanations",
               [PYTHON, "-u", "scripts/evaluate_ablation.py",
                "--informed", "--n", str(args.n)])
    written = count_lines(RECORDS)
    if code != 0:
        # 139 is SIGSEGV - the known Qwen loading crash on this machine.
        print(f"\nGeneration exited {code} with {written} images written.")
        if written == 0:
            sys.exit("Nothing was generated - most likely the model failed to "
                     "load. Reboot and re-run; nothing is lost.")
        print("Continuing with what completed - the sample was shuffled, so a "
              "partial run is still valid.")

    # ── 2. corpus ──
    if count_lines(RECORDS) == 0:
        sys.exit("No informed records to build a corpus from.")
    run("STEP 2/3  build the judge corpus",
        [PYTHON, "-u", "scripts/build_explanation_corpus.py", "--informed"])

    # ── 3. judge ──
    if count_lines(CORPUS) == 0:
        sys.exit("Corpus is empty - nothing to judge.")
    run("STEP 3/3  judge the explanations",
        [PYTHON, "-u", "scripts/run_judge_eval.py", CORPUS],
        env={
            "JUDGE_PROVIDER": "local",
            # The 250/day guard is the Gemini free-tier limit. An on-device
            # judge has no quota, and the guard would otherwise halt the run.
            "JUDGE_DAILY_QUOTA": "100000",
            "JUDGE_RPM": "600",
        })

    print(f"\n{'=' * 66}")
    print(f"DONE in {(time.time() - started) / 60:.0f} min. "
          f"{count_lines(CORPUS)} explanations judged.")
    print("Next: python scripts/compare_informed.py")
    print("=" * 66)


if __name__ == "__main__":
    main()
