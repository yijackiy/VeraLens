import json
import re

from PIL import Image

from backend.app.llm.model import load_qwen
from backend.app.llm.prompts import (BLIND_FORENSIC_PROMPT, FORENSIC_PROMPT,
                                     GUIDED_FORENSIC_PROMPT,
                                     describe_assessment)

MAX_RETRIES = 3
MAX_NEW_TOKENS = 512

# The reasoning layer samples. It always has: these are the values Qwen3-VL
# ships in its generation_config.json, which generate() inherited silently
# until they were written out here — and nothing ever overrode do_sample, so
# every reported explanation and every live Analysis is one draw from this
# distribution, not "the" answer for its photo (ADR 0013).
#
# Spelled out rather than inherited so the evaluated behaviour cannot drift:
# model.py pins the snapshot too, but a value that lives only in a JSON file
# on someone's cache is not a decision anyone made. Changing any of these
# changes what the reported Explanation Quality numbers describe.
SAMPLING = {"do_sample": True, "temperature": 0.7, "top_p": 0.8, "top_k": 20}

VALID_VERDICTS = ("real", "fake")

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Small VLMs sometimes wrap output in markdown fences or add stray text —
    # fall back to extracting the first {...} block.
    match = _JSON_BLOCK_RE.search(text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


def _unit_float(value) -> float | None:
    """
    Reads a model-supplied 0.0-1.0 number, or returns None when it cannot be
    read as one. A 2B model writes 0.81, "0.81" and "81%" interchangeably, so
    all three are accepted; anything else is a failure to report, not a value
    to guess at.
    """
    if isinstance(value, bool):  # bool is a subclass of int, but not a score
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        try:
            number = float(text.rstrip("%").strip())
        except ValueError:
            return None
        if text.endswith("%"):
            number /= 100.0
    else:
        return None
    if number != number:  # NaN
        return None
    return number


def _clean_signals(raw) -> list:
    """
    Keeps the well-formed entries and drops the rest. One malformed signal
    should not cost the caller the explanation and the other three, and
    severity only drives a bar in the interface — so it is clamped rather
    than rejected, unlike confidence.
    """
    if not isinstance(raw, list):
        return []
    cleaned = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        severity = _unit_float(item.get("severity"))
        note = item.get("note")
        cleaned.append({
            "name": name.strip(),
            "severity": 0.0 if severity is None else min(1.0, max(0.0, severity)),
            "note": note.strip() if isinstance(note, str) else "",
        })
    return cleaned


def _validate(parsed) -> dict | None:
    """
    Returns the reply in the schema the prompt asked for, or None when the
    model produced valid JSON of the wrong shape — which the caller then
    treats exactly like unparseable text, and retries.

    Valid-but-wrong-shaped JSON is a separate failure from unparseable text
    and was previously unguarded: `{"foo": 1}`, a bare list, or a missing
    "signals" key all reached fuse() and raised KeyError or TypeError
    mid-request, surfacing as an HTTP 500 the interface can say nothing
    useful about. evaluate_ablation.py already defends against this; the
    production path did not.

    confidence is rejected rather than clamped, because it is weighted into
    the fused Fake Probability — inventing a number there is worse than
    admitting the reply was unusable.
    """
    if not isinstance(parsed, dict):
        return None

    verdict = parsed.get("verdict")
    if not isinstance(verdict, str) or verdict.strip().lower() not in VALID_VERDICTS:
        return None

    confidence = _unit_float(parsed.get("confidence"))
    if confidence is None or not 0.0 <= confidence <= 1.0:
        return None

    explanation = parsed.get("explanation")
    if not isinstance(explanation, str) or not explanation.strip():
        return None

    return {
        "verdict": verdict.strip().lower(),
        "confidence": confidence,
        "signals": _clean_signals(parsed.get("signals")),
        "explanation": explanation.strip(),
    }


def run_reasoning(face_crop_pil: Image.Image,
                  fake_score: float | None = None,
                  legacy_numeric: bool = False) -> dict:
    """
    Runs Qwen3-VL-2B on the face crop + classifier score and returns the
    forensic verdict, normalised to the prompt's schema. Retries a few times
    when the reply is unparseable *or* parses to the wrong shape, before
    giving up and returning an "unknown" result with the raw text attached.
    Every returned dict therefore has a real verdict, a float confidence in
    [0,1], a list of well-formed signals, and a non-empty explanation.

    fake_score=None withholds the classifier score and uses the blind prompt.
    That is for the ablation only: it keeps the reasoning layer independent
    of the classifier so their fusion is not double-counting one signal.

    When fake_score is given it is described in words, not interpolated as a
    numeral: this model copies an injected number straight into its own
    confidence field instead of judging for itself (ADR 0008).

    legacy_numeric=True restores that broken behaviour. It exists only to
    reproduce the bug for the write-up and must not be used in the app.
    """
    model, processor = load_qwen()
    if fake_score is None:
        prompt = BLIND_FORENSIC_PROMPT.format()
    elif legacy_numeric:
        prompt = FORENSIC_PROMPT.format(fake_score=fake_score)
    else:
        prompt = GUIDED_FORENSIC_PROMPT.format(
            assessment=describe_assessment(fake_score))
    messages = [{"role": "user", "content": [
        {"type": "image", "image": face_crop_pil},
        {"type": "text", "text": prompt},
    ]}]

    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    ).to(model.device)

    last_raw = ""
    for _attempt in range(MAX_RETRIES):
        # Every attempt, the first included, is a fresh sample. This loop
        # used to say the first was greedy and only retries sampled; neither
        # was true — do_sample was never set, so all of them inherited the
        # model's sampling defaults. A retry works because it is another
        # sample, which was the case all along.
        #
        # These attempts are all one Draw (CONTEXT.md). A parse failure
        # retried into a success is a single Draw that produced an
        # explanation, not two Draws.
        output = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, **SAMPLING)
        # Only decode the newly generated tokens, not the echoed prompt.
        new_tokens = output[:, inputs["input_ids"].shape[1]:]
        text = processor.batch_decode(new_tokens, skip_special_tokens=True)[0]
        last_raw = text

        validated = _validate(_parse_json(text))
        if validated is not None:
            return validated

    return {
        "verdict": "unknown", "confidence": 0.0, "signals": [],
        "explanation": "Parsing failed — raw output logged for debugging.",
        "_raw": last_raw,
    }


if __name__ == "__main__":
    import sys
    from backend.app.preprocessing.face_pipeline import get_face_crop
    from backend.app.classifier.classifier import classify

    img_path = sys.argv[1] if len(sys.argv) > 1 else None
    if img_path is None:
        print("Usage: python -m backend.app.llm.reasoner <image_path>")
        sys.exit(1)

    crop_bgr = get_face_crop(img_path)
    if crop_bgr is None:
        print("No face detected.")
        sys.exit(1)

    fake_score = classify(crop_bgr)["fake_score"]
    crop_pil = Image.fromarray(crop_bgr[:, :, ::-1])  # BGR -> RGB
    result = run_reasoning(crop_pil, fake_score)
    print(json.dumps(result, indent=2))
