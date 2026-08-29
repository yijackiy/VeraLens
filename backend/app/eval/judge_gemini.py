"""
Step 4.4b — Gemini 2.5 Flash judge.

Free tier: 10 req/min, 250 req/day, EUR 0. Chosen over the paid alternatives:
free, newer, and stronger on judge-human agreement.

Three properties make the scores usable as thesis evidence:
  - schema-constrained JSON output, so nothing is ever parsed by string matching
  - temperature 0, so the same input yields the same score
  - the exact resolved model version recorded on every single call
"""

from backend.app.config import JUDGE_MODEL, require
from backend.app.eval.judge import FatalJudgeError
from backend.app.eval.rubric import SCHEMA, TEMPERATURE, build_prompt

_FATAL_MARKERS = ("api key not valid", "permission denied", "unauthorized",
                  "invalid_argument", "not found")


class GeminiJudge:
    name = "gemini"

    def __init__(self, model: str | None = None):
        try:
            from google import genai
        except ImportError as exc:  # pragma: no cover - environment problem
            raise FatalJudgeError(
                "google-genai is not installed. pip install google-genai"
            ) from exc

        self.model = model or JUDGE_MODEL
        self.client = genai.Client(api_key=require("GEMINI_API_KEY"))

    def score(self, explanation: str, ground_truth_signals) -> dict:
        from google.genai import types

        try:
            resp = self.client.models.generate_content(
                model=self.model,
                contents=build_prompt(explanation, ground_truth_signals),
                config=types.GenerateContentConfig(
                    temperature=TEMPERATURE,   # determinism
                    top_p=1.0,
                    seed=42,
                    candidate_count=1,
                    response_mime_type="application/json",
                    response_schema=SCHEMA,    # no regex parsing, ever
                    # Gemini 2.5 Flash thinks by default. Thinking tokens count
                    # against the output budget (an empty `parsed` when they
                    # exhaust it) and reintroduce run-to-run variation that
                    # temperature=0 is supposed to remove. A 1-5 rubric score
                    # does not need a scratchpad.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
        except Exception as exc:
            message = str(exc).lower()
            if any(marker in message for marker in _FATAL_MARKERS):
                raise FatalJudgeError(str(exc)) from exc
            raise  # transient (429, 5xx, timeout) — let the backoff retry it

        parsed = getattr(resp, "parsed", None)
        if isinstance(parsed, str) or parsed is None:
            # The schema should guarantee a dict. If it did not, that is a
            # failure to record, not something to guess our way around.
            import json
            try:
                parsed = json.loads(resp.text)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"judge returned unparseable output: {resp.text!r}"
                ) from exc

        # `isinstance(True, int)` is True in Python — exclude bools explicitly.
        if isinstance(parsed.get("score"), bool) or not isinstance(parsed.get("score"), int):
            raise ValueError(f"judge returned no integer score: {parsed!r}")

        return {
            "score": parsed["score"],
            "rationale": parsed.get("rationale", ""),
            # Exact resolved version, not the "gemini-2.5-flash" alias we asked
            # for — aliases get repointed at new models without notice.
            "model_version": getattr(resp, "model_version", None) or self.model,
            "raw": resp.text,
        }
