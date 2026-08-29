"""
Step 4.4 — the scoring rubric, versioned.

RUBRIC_VERSION is part of the cache key and is stored on every score row.
Change the rubric text and you MUST bump the version, otherwise old scores and
new scores end up pooled in the same aggregate under a rubric that only one of
them was actually judged against.
"""

RUBRIC_VERSION = "v1"

RUBRIC = """You are grading a forensic explanation produced by a deepfake detection system.

Rate from 1 to 5 how accurate and useful the explanation is, given the ground-truth signals:
5 = accurate and specific; names the real artefacts and describes them correctly.
4 = accurate, but vague or missing a signal that is clearly present.
3 = partially correct; mixes a correct observation with an unsupported one.
2 = mostly wrong; names artefacts that are not present, or contradicts the ground truth.
1 = wrong or unusable; generic boilerplate, or no forensic content at all.

Judge only the explanation's forensic content. Do not reward confident phrasing,
length, or fluency."""

# Schema-constrained output. Free text parsed by string matching fails silently
# and corrupts scores nobody notices, so the model is never allowed to reply
# with prose.
SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 1, "maximum": 5},
        "rationale": {"type": "string"},
    },
    "required": ["score", "rationale"],
}

# Temperature is pinned at 0 and stored on every row. The same input must yield
# the same score, or this is not a measurement instrument.
TEMPERATURE = 0.0


def build_prompt(explanation: str, ground_truth_signals) -> str:
    return (
        f"{RUBRIC}\n\n"
        f"Ground-truth signals: {ground_truth_signals}\n\n"
        f"Explanation to grade: {explanation}"
    )
