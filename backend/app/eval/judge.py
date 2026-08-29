"""
Step 4.4a — the judge interface.

Ethics approval for sending data to a third-party API is unresolved, so the
judge sits behind an interface with an on-device implementation alongside the
API one. A restrictive ruling is then a change to JUDGE_PROVIDER, not a
rewrite. The fallback is deliberately local rather than a second vendor —
swapping one external API for another would not answer the objection.
"""

from typing import Protocol, runtime_checkable

from backend.app.config import JUDGE_PROVIDER


class FatalJudgeError(Exception):
    """
    Not worth retrying: a bad API key, a malformed request, a missing model.
    Backoff must not burn five attempts on a configuration mistake.
    """


@runtime_checkable
class IJudge(Protocol):
    #: identifies the backend in the stored score row
    name: str
    #: model alias requested (the resolved version comes back per call)
    model: str

    def score(self, explanation: str, ground_truth_signals) -> dict:
        """
        Returns a dict with:
            score         int 1-5
            rationale     str
            model_version str  — the EXACT resolved version, per call
            raw           str  — unparsed response text, kept as audit trail

        Raises on failure. The caller (runner.py) records the failure as a
        failure; an implementation must never invent a score to paper over an
        error.
        """
        ...


def get_judge() -> IJudge:
    """Builds the judge named by JUDGE_PROVIDER. Imports lazily so the local
    path does not require the Gemini SDK, and vice versa."""
    if JUDGE_PROVIDER == "gemini":
        from backend.app.eval.judge_gemini import GeminiJudge
        return GeminiJudge()
    if JUDGE_PROVIDER == "local":
        from backend.app.eval.judge_local import LocalJudge
        return LocalJudge()
    raise ValueError(
        f"unknown JUDGE_PROVIDER: {JUDGE_PROVIDER!r} (expected 'gemini' or 'local')"
    )
