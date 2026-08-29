"""
Step 4.4f — append-only storage for judge scores.

One row per judge call. Rows are never updated or deleted: the raw model
response is retained as the audit trail for the defence, and it is what you
need when a score looks wrong. A failed call is stored with ok=False and
score=NULL — never as a numeric 0, which would be indistinguishable from a
genuine score of 0 once it is in the dataset.
"""

import datetime as dt
import os

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, MetaData, String, Table, Text,
    create_engine, func, select,
)

from backend.app.config import DATABASE_URL, is_sqlite_fallback

metadata = MetaData()

judge_scores = Table(
    "judge_scores", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("created_at", DateTime(timezone=True), nullable=False,
           default=lambda: dt.datetime.now(dt.timezone.utc)),
    Column("cache_key", String(64), nullable=False, index=True),
    Column("provider", String(32), nullable=False),
    # Exact resolved version returned by the API, not the alias we asked for.
    # Models get deprecated and replaced; without this the results are not
    # reproducible, and "which model, exactly?" is a defence question.
    Column("model_version", String(128)),
    Column("rubric_version", String(32), nullable=False),
    Column("temperature", Float, nullable=False),
    Column("sample_id", String(256), nullable=False),
    Column("score", Integer),          # NULL when ok = False
    Column("rationale", Text),
    Column("raw_response", Text),      # full text, for the audit trail
    Column("ok", Boolean, nullable=False),
    Column("error", Text),
    # API attempts this row cost, retries included. Quota is consumed per
    # attempt, not per row, so counting rows would undercount badly whenever
    # the backoff fires.
    Column("attempts", Integer, nullable=False, default=1),
)

_engine = None


def get_engine():
    global _engine
    if _engine is not None:
        return _engine

    if is_sqlite_fallback():
        os.makedirs(os.path.dirname(DATABASE_URL.replace("sqlite:///", "")),
                    exist_ok=True)
        print("[storage] DATABASE_URL not set — using local SQLite. Fine for "
              "development; point at Neon/Supabase before the final run.")

    _engine = create_engine(DATABASE_URL, future=True)
    metadata.create_all(_engine)
    return _engine


def lookup(key: str) -> dict | None:
    """
    Returns the cached successful score for this key, or None.
    Failures are deliberately not cached — a transient 429 or timeout must be
    retried on the next run, not frozen into the dataset.
    """
    stmt = (select(judge_scores)
            .where(judge_scores.c.cache_key == key, judge_scores.c.ok.is_(True))
            .order_by(judge_scores.c.id.desc())
            .limit(1))
    with get_engine().connect() as conn:
        row = conn.execute(stmt).mappings().first()
    return dict(row) if row else None


def append(row: dict) -> None:
    """Insert one score row. Append-only: nothing here ever updates."""
    with get_engine().begin() as conn:
        conn.execute(judge_scores.insert().values(**row))


def calls_today() -> int:
    """
    API attempts in the last 24h, used to stay inside the free-tier daily
    quota. Sums `attempts` rather than counting rows: one row can cost up to
    five calls when the backoff retries, and the provider charges the quota for
    every one of them. Cache hits write nothing and so cost nothing.

    Rolling 24h, which is stricter than the provider's midnight reset — the
    conservative direction to be wrong in.
    """
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    stmt = (select(func.coalesce(func.sum(judge_scores.c.attempts), 0))
            .where(judge_scores.c.created_at >= since))
    with get_engine().connect() as conn:
        return int(conn.execute(stmt).scalar_one())


def summary() -> dict:
    """Counts for the evaluation write-up: total, successful, failed."""
    with get_engine().connect() as conn:
        total = conn.execute(
            select(func.count()).select_from(judge_scores)).scalar_one()
        failed = conn.execute(
            select(func.count()).select_from(judge_scores)
            .where(judge_scores.c.ok.is_(False))).scalar_one()
        mean = conn.execute(
            select(func.avg(judge_scores.c.score))
            .where(judge_scores.c.ok.is_(True))).scalar_one()
    return {
        "total_rows": int(total),
        "scored": int(total) - int(failed),
        "failed": int(failed),
        # Failed calls are excluded from the aggregate, and their count is
        # reported alongside it in the thesis.
        "mean_score": round(float(mean), 3) if mean is not None else None,
    }


if __name__ == "__main__":
    get_engine()
    print("[storage] judge_scores ready.")
    print(summary())
