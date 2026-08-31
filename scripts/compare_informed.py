"""
Compare Explanation Quality: blind reasoning vs production (informed).

The ablation runs the VLM blind so the LLM-Only arm stays honest (ADR 0003).
Production instead hands it the classifier's score. This script asks what that
difference is worth, using the judge scores for both.

Pairing: the informed corpus uses `inf_`-prefixed sample_ids over the same
images, so scores can be matched per image. Paired differences are tested with
an exact sign test - a mean can shift on a handful of images, and the count of
images that actually moved is what says whether the shift is real.

Usage:
    python scripts/compare_informed.py
"""

import os
import sys
from collections import defaultdict
from math import comb

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)
sys.path.insert(0, REPO_ROOT)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import select

from backend.app.eval import storage

OUT = os.path.join("results", "informed_vs_blind.json")


def sign_test(pairs):
    """Exact two-sided sign test on paired score changes.

    Ties carry no directional evidence and are dropped, which is what makes
    this the right test here: most explanations will not move at all.
    """
    up = sum(1 for before, after in pairs if after > before)
    down = sum(1 for before, after in pairs if after < before)
    n = up + down
    if n == 0:
        return up, down, 1.0
    tail = sum(comb(n, k) for k in range(min(up, down) + 1))
    return up, down, min(tail / 2 ** n * 2, 1.0)


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def main():
    engine = storage.get_engine()
    t = storage.judge_scores
    with engine.connect() as conn:
        # Ordered by id so a re-scored sample_id (e.g. after a prompt fix)
        # overwrites the earlier row rather than being averaged with it.
        rows = conn.execute(
            select(t.c.sample_id, t.c.score, t.c.ok).order_by(t.c.id)).all()

    blind, informed = {}, {}
    for r in rows:
        if not r.ok or r.score is None:
            continue
        if r.sample_id.startswith("inf_"):
            informed[r.sample_id[4:]] = r.score
        else:
            blind[r.sample_id] = r.score

    if not informed:
        sys.exit("No informed scores found. Run scripts/run_informed_pipeline.py "
                 "first.")

    def by_class(d):
        out = defaultdict(list)
        for key, score in d.items():
            out[key.split("_", 1)[0]].append(score)
        return out

    b_cls, i_cls = by_class(blind), by_class(informed)
    shared = sorted(set(blind) & set(informed))

    print("=" * 66)
    print("EXPLANATION QUALITY - blind vs production (informed)")
    print("=" * 66)
    print(f"  {'':<8}{'blind':>18}{'informed':>18}")
    print(f"  {'':<8}{'n':>7}{'mean':>11}{'n':>7}{'mean':>11}")
    for cls in ("fake", "real"):
        bs, is_ = b_cls.get(cls, []), i_cls.get(cls, [])
        print(f"  {cls:<8}{len(bs):>7}{mean(bs):>11.2f}"
              f"{len(is_):>7}{mean(is_):>11.2f}")
    all_b = [s for v in b_cls.values() for s in v]
    all_i = [s for v in i_cls.values() for s in v]
    print(f"  {'all':<8}{len(all_b):>7}{mean(all_b):>11.2f}"
          f"{len(all_i):>7}{mean(all_i):>11.2f}")

    payload = {
        "blind": {c: {"n": len(v), "mean": round(mean(v), 3)}
                  for c, v in b_cls.items()},
        "informed": {c: {"n": len(v), "mean": round(mean(v), 3)}
                     for c, v in i_cls.items()},
        "paired": {},
    }

    if shared:
        print(f"\n  Paired on {len(shared)} images scored in both modes")
        for cls in ("fake", "real", None):
            keys = [k for k in shared
                    if cls is None or k.split("_", 1)[0] == cls]
            if not keys:
                continue
            pairs = [(blind[k], informed[k]) for k in keys]
            up, down, p = sign_test(pairs)
            delta = mean([a for _, a in pairs]) - mean([b for b, _ in pairs])
            label = cls or "all"
            print(f"    {label:<6} n={len(pairs):<4} delta={delta:+.2f}  "
                  f"better={up} worse={down} same={len(pairs) - up - down}  "
                  f"p={p:.4f}")
            payload["paired"][label] = {
                "n": len(pairs), "delta": round(delta, 3),
                "improved": up, "worsened": down,
                "unchanged": len(pairs) - up - down,
                "sign_test_p": round(p, 4),
            }
    else:
        print("\n  No overlapping images - cannot pair. Compare the group "
              "means above with care.")

    print("\n  Note: both modes were graded by the same judge. If that judge "
          "is\n  the local Qwen, it is grading its own output in both arms "
          "(ADR 0007),\n  so the comparison is fairer than either absolute "
          "number.")
    print("=" * 66)

    import json
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
