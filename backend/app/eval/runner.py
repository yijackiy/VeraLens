"""
Steps 4.4c-4.4g — the orchestration around a judge call.

Cache first, then throttle, then call with backoff, then append the row —
whether the call succeeded or not. This is the only place that writes to
judge_scores, and the only place that decides what a failure looks like.

Batch use only. A judge call takes 5-30 s and is capped at 10/min; putting one
in a request handler will time the request out.
"""

import datetime as dt
import time

from tenacity import (
    retry, retry_if_not_exception_type, stop_after_attempt,
    wait_random_exponential,
)

from backend.app import config
from backend.app.eval import storage
from backend.app.eval.cache import cache_key
from backend.app.eval.judge import FatalJudgeError, get_judge
from backend.app.eval.rubric import RUBRIC_VERSION, TEMPERATURE


class QuotaExhausted(RuntimeError):
    """Daily free-tier quota reached. Stop the run; do not write junk rows."""


class RateLimiter:
    """
    Client-side sliding-window throttle. Backoff alone will not save a batch
    run — by the time the 429s arrive the quota is already being burned, so
    stay under the limit rather than discovering it.
    """

    def __init__(self, rpm: int):
        self.rpm = rpm
        self._calls: list[float] = []

    def acquire(self) -> None:
        now = time.monotonic()
        self._calls = [t for t in self._calls if now - t < 60.0]
        if len(self._calls) >= self.rpm:
            wait = 60.0 - (now - self._calls[0]) + 0.1
            print(f"[judge] rate limit: sleeping {wait:.1f}s")
            time.sleep(wait)
            now = time.monotonic()
            self._calls = [t for t in self._calls if now - t < 60.0]
        self._calls.append(now)


class _AttemptCounter:
    """Counts API attempts for one sample. Retries consume quota too."""

    def __init__(self):
        self.n = 0


@retry(
    wait=wait_random_exponential(min=2, max=60),   # exponential + jitter
    stop=stop_after_attempt(5),
    retry=retry_if_not_exception_type(FatalJudgeError),
    reraise=True,
)
def _call_with_backoff(judge, explanation, signals, limiter, attempts):
    # Throttle and count per attempt, not per sample: a retry is another
    # request against the same 10/min and 250/day budget.
    attempts.n += 1
    if limiter is not None:
        limiter.acquire()
    return judge.score(explanation, signals)


def score_one(judge, sample_id: str, explanation: str, signals,
              limiter: RateLimiter | None = None) -> dict:
    """
    Scores one explanation. Returns the stored row.

    A cache hit returns the earlier row and makes no API call, so repeat runs
    are free and produce byte-identical scores.
    """
    key = cache_key(RUBRIC_VERSION, judge.model, TEMPERATURE, explanation, signals)

    cached = storage.lookup(key)
    if cached is not None:
        cached["cached"] = True
        return cached

    spent = storage.calls_today()
    if spent >= config.JUDGE_DAILY_QUOTA:
        raise QuotaExhausted(
            f"{spent} API calls in the last 24h, quota is "
            f"{config.JUDGE_DAILY_QUOTA} — stopping. Re-run tomorrow; "
            f"everything already scored is cached."
        )

    attempts = _AttemptCounter()
    row = {
        "created_at": dt.datetime.now(dt.timezone.utc),
        "cache_key": key,
        "provider": judge.name,
        "rubric_version": RUBRIC_VERSION,
        "temperature": TEMPERATURE,
        "sample_id": sample_id,
    }
    try:
        result = _call_with_backoff(judge, explanation, signals, limiter, attempts)
    except FatalJudgeError:
        # A bad key or a malformed request is a configuration mistake, not data
        # about this sample. Do not write a row: it would inflate the failure
        # count reported in the thesis, and the run would carry on producing
        # hundreds more. Let it abort the batch instead.
        raise
    except Exception as exc:
        # 4.4e — a failure is recorded as a failure. Storing 0 here would be
        # indistinguishable from a genuine 0 and would drag the mean down
        # silently.
        row.update(score=None, rationale=None, raw_response=None, ok=False,
                   model_version=None, attempts=attempts.n,
                   error=f"{type(exc).__name__}: {exc}")
    else:
        row.update(score=result["score"],
                   rationale=result.get("rationale", ""),
                   raw_response=result.get("raw", ""),
                   model_version=result.get("model_version"),
                   attempts=attempts.n, ok=True, error=None)

    storage.append(row)
    row["cached"] = False
    return row


def score_many(samples, judge=None) -> dict:
    """
    samples: iterable of (sample_id, explanation, ground_truth_signals).
    Returns the run summary. Stops early and reports on quota exhaustion or a
    fatal configuration error, rather than filling the table with junk.
    """
    judge = judge or get_judge()
    limiter = RateLimiter(config.JUDGE_RPM)
    storage.get_engine()

    scored = failed = cached = 0
    print(f"[judge] provider={judge.name} model={judge.model} "
          f"rubric={RUBRIC_VERSION} temperature={TEMPERATURE}")

    for i, (sample_id, explanation, signals) in enumerate(samples, start=1):
        try:
            row = score_one(judge, sample_id, explanation, signals, limiter)
        except (QuotaExhausted, FatalJudgeError) as exc:
            print(f"[judge] stopping at sample {i}: {exc}")
            break

        if row.get("cached"):
            cached += 1
        elif row["ok"]:
            scored += 1
        else:
            failed += 1
            print(f"[judge] FAILED {sample_id}: {row['error']}")

        if i % 10 == 0:
            print(f"[judge] {i} processed "
                  f"({scored} new, {cached} cached, {failed} failed)")

    result = {"new_calls": scored, "cache_hits": cached, "failures": failed}
    result.update(storage.summary())
    return result
