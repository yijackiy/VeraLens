FORENSIC_PROMPT = """You are a forensic image analyst. You are given a cropped
face photo and a visual classifier's fake-probability score of {fake_score:.2f}.

Examine these signals: hairline boundary consistency, eye highlight symmetry,
skin texture consistency, lighting direction consistency, edge blending around
the face contour.

Respond ONLY with valid JSON in this exact schema:
{{
  "verdict": "real" | "fake",
  "confidence": 0.0-1.0,
  "signals": [{{"name": str, "severity": 0.0-1.0, "note": str}}],
  "explanation": "2-3 sentence plain-English summary"
}}"""

# Ablation-only. FORENSIC_PROMPT hands the classifier's score to the VLM, which
# is right for production (the explanation should account for the score) but
# circular for measuring the reasoning layer's own detection contribution: a
# "LLM-only" arm that can read the classifier's answer is not LLM-only. This
# variant withholds it so the two signals stay independent.
BLIND_FORENSIC_PROMPT = """You are a forensic image analyst. You are given a
cropped face photo. Decide, from the image alone, whether it is a real
photograph or a synthetically generated (deepfake) face.

Examine these signals: hairline boundary consistency, eye highlight symmetry,
skin texture consistency, lighting direction consistency, edge blending around
the face contour.

Respond ONLY with valid JSON in this exact schema:
{{
  "verdict": "real" | "fake",
  "confidence": 0.0-1.0,
  "signals": [{{"name": str, "severity": 0.0-1.0, "note": str}}],
  "explanation": "2-3 sentence plain-English summary"
}}"""


# Ablation/experiment prompt. FORENSIC_PROMPT interpolates the classifier's
# score as a bare number, and a 2B model echoes that number straight back as
# its own "confidence" field — observed on 4/4 samples, producing incoherent
# rows like verdict "fake" with confidence 0.0, or "real" at 0.99 when the
# classifier said 0.99 FAKE. Two changes: state the classifier's finding in
# words so there is no numeral to copy, and say explicitly that confidence
# means the model's own certainty in its own verdict.
GUIDED_FORENSIC_PROMPT = """You are a forensic image analyst reviewing a
cropped face photo.

A separate visual detector has already examined this image and judged it
{assessment}. Your job is to look at the image yourself and describe the
visual evidence, then give your own verdict. Agree with the detector if the
image supports it; disagree if it does not.

Examine these signals: hairline boundary consistency, eye highlight symmetry,
skin texture consistency, lighting direction consistency, edge blending around
the face contour.

Respond ONLY with valid JSON in this exact schema:
{{
  "verdict": "real" | "fake",
  "confidence": 0.0-1.0,
  "signals": [{{"name": str, "severity": 0.0-1.0, "note": str}}],
  "explanation": "2-3 sentence plain-English summary"
}}

"confidence" is how certain YOU are of YOUR verdict. It is not the detector's
score and must not be copied from it."""


def describe_assessment(fake_score: float) -> str:
    """The detector's finding in words, so there is no numeral to echo back."""
    if fake_score >= 0.90:
        return "very likely MANIPULATED (a synthetic or swapped face)"
    if fake_score >= 0.60:
        return "probably MANIPULATED"
    if fake_score > 0.40:
        return "borderline, with no clear indication either way"
    if fake_score > 0.10:
        return "probably AUTHENTIC"
    return "very likely AUTHENTIC (a genuine photograph)"
