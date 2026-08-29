"""
Step 4.5 — local backup of the judge_scores table.

Free tiers are free, not guaranteed. Losing evaluation data close to submission
is unrecoverable, so keep a copy outside the hosting provider. Writes a
timestamped JSONL dump (portable, diffable, and readable without a database)
under backups/.

Usage:
    python scripts/backup_judge_scores.py
    python scripts/backup_judge_scores.py --out-dir /path/to/backups

Run it after every evaluation batch, and once more before submission.
"""

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from backend.app.config import PROJECT_ROOT, is_sqlite_fallback
from backend.app.eval import storage


def dump(out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(out_dir, f"judge_scores_{stamp}.jsonl")

    engine = storage.get_engine()
    rows = 0
    with engine.connect() as conn, open(path, "w", encoding="utf-8") as f:
        for row in conn.execute(select(storage.judge_scores)).mappings():
            record = dict(row)
            record["created_at"] = str(record["created_at"])
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            rows += 1

    print(f"[backup] {rows} rows -> {path}")
    if is_sqlite_fallback():
        print("[backup] source was the local SQLite fallback, not a hosted DB — "
              "set DATABASE_URL (Neon/Supabase) before the final evaluation run.")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Back up judge_scores to JSONL.")
    parser.add_argument("--out-dir", default=os.path.join(PROJECT_ROOT, "backups"))
    args = parser.parse_args()
    dump(args.out_dir)
