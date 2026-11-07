"""
Where an Analysis has got to, for the interface to ask about while it waits.

POST /analyze blocks and answers once, a minute at the median and nearer three
at p90 (see ADR 0015), so a second short request is the only way to say more
than "still going". This module is the memory that request reads.

It reports a stage and, inside the stage that dominates the wait, a count of
tokens written. It does not report a fraction, an estimate or an ETA, on
purpose: the wait is long-tailed and nothing here can say how much of it is
left, so a percentage would be invented. The stage is what is known.

Reporting is ambient rather than passed down as an argument. run_reasoning()
and run_pipeline_from_crop() are also called by the evaluation scripts with no
request around them, and the tests replace the pipeline with fakes of a fixed
signature; a callback parameter threaded through three layers would break both
for the sake of a progress bar. The /analyze handler runs in one threadpool
thread from the first line to the last, so a ContextVar set there is visible
to everything it calls, and invisible to a request on another thread.
"""

import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar

# In the order they happen. "queued" is real: the GPU lock serialises
# Analyses, and a second one waits there, silently, until the first finishes.
STAGES = ("queued", "classifying", "saliency", "loading", "writing")

_current: ContextVar[str | None] = ContextVar("analysis_token", default=None)
_lock = threading.Lock()
_state: dict[str, dict] = {}


@contextmanager
def track(token: str):
    """Everything reported inside this block belongs to `token`, and is
    forgotten when the block ends, however it ends. Nothing outlives the
    request, so an abandoned analysis leaves no entry to sweep."""
    with _lock:
        _state[token] = {"stage": "queued", "started": time.monotonic()}
    marker = _current.set(token)
    try:
        yield
    finally:
        _current.reset(marker)
        with _lock:
            _state.pop(token, None)


def report(stage: str, **detail) -> None:
    """Move the current Analysis to `stage`. A no-op when there is no current
    Analysis, which is every call from an evaluation script."""
    token = _current.get()
    if token is None:
        return
    with _lock:
        entry = _state.get(token)
        if entry is None:
            return
        # Detail belongs to the stage that reported it. Carrying `tokens` from
        # one writing attempt into the next would show a count that is no
        # longer true.
        _state[token] = {"stage": stage, "started": entry["started"], **detail}


def snapshot(token: str) -> dict | None:
    """What the interface sees: the stage, its detail, and seconds since the
    Analysis began. None for a token that is not running."""
    with _lock:
        entry = _state.get(token)
        if entry is None:
            return None
        out = {k: v for k, v in entry.items() if k != "started"}
        out["elapsed_seconds"] = round(time.monotonic() - entry["started"], 1)
        return out
