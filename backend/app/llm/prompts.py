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
