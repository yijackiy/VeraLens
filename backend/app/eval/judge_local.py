"""
Step 4.4a — on-device judge, the ethics fallback.

Reuses the Qwen3-VL-2B weights already on disk, text-only (no image is sent to
the judge — it grades the written explanation against the ground-truth
signals). Weaker than Gemini, but no data leaves the machine, which is the
point: if the ethics ruling forbids a third-party API, JUDGE_PROVIDER=local is
the whole change.

Runs as a batch job, so it has the GPU to itself — the Week 2 sequential
loading rule still holds, this must not run alongside the classifier.
"""

import json
import re

from backend.app.eval.judge import FatalJudgeError
from backend.app.eval.rubric import SCHEMA, build_prompt

MAX_NEW_TOKENS = 256

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)

_SCHEMA_INSTRUCTION = (
    "\n\nRespond ONLY with valid JSON in this exact schema, no prose, no "
    "markdown fences:\n"
    '{"score": <integer 1-5>, "rationale": "<one sentence>"}'
)


class LocalJudge:
    name = "local"

    def __init__(self):
        try:
            from backend.app.llm.model import load_qwen, MODEL_ID
        except ImportError as exc:  # pragma: no cover - environment problem
            raise FatalJudgeError(f"local judge unavailable: {exc}") from exc

        self._model, self._processor = load_qwen()
        self.model = MODEL_ID
        # Pin the exact weights, not just the repo name: the Hub alias can move.
        commit = getattr(self._model.config, "_commit_hash", None)
        self._resolved = f"{MODEL_ID}@{commit}" if commit else MODEL_ID

    def score(self, explanation: str, ground_truth_signals) -> dict:
        prompt = build_prompt(explanation, ground_truth_signals) + _SCHEMA_INSTRUCTION
        messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

        inputs = self._processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(self._model.device)

        # Greedy: same determinism requirement as the Gemini path.
        output = self._model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS,
                                      do_sample=False)
        new_tokens = output[:, inputs["input_ids"].shape[1]:]
        text = self._processor.batch_decode(new_tokens, skip_special_tokens=True)[0]

        parsed = self._parse(text)
        if parsed is None or not isinstance(parsed.get("score"), int):
            # No silent default. The runner records this as a failure.
            raise ValueError(f"local judge returned unparseable output: {text!r}")

        lo, hi = SCHEMA["properties"]["score"]["minimum"], SCHEMA["properties"]["score"]["maximum"]
        if not lo <= parsed["score"] <= hi:
            raise ValueError(f"local judge score out of range: {parsed['score']}")

        return {
            "score": parsed["score"],
            "rationale": parsed.get("rationale", ""),
            "model_version": self._resolved,
            "raw": text,
        }

    @staticmethod
    def _parse(text: str) -> dict | None:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        match = _JSON_BLOCK_RE.search(text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        return None
