import json
import re

from PIL import Image

from backend.app.llm.model import load_qwen
from backend.app.llm.prompts import BLIND_FORENSIC_PROMPT, FORENSIC_PROMPT

MAX_RETRIES = 3
MAX_NEW_TOKENS = 512

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict | None:
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


def run_reasoning(face_crop_pil: Image.Image,
                  fake_score: float | None = None) -> dict:
    """
    Runs Qwen3-VL-2B on the face crop + classifier score and returns the
    parsed forensic verdict. Retries a few times on JSON parse failure before
    giving up and returning an "unknown" result with the raw text attached.

    fake_score=None withholds the classifier score and uses the blind prompt.
    That is for the ablation only: it keeps the reasoning layer independent
    of the classifier so their fusion is not double-counting one signal.
    """
    model, processor = load_qwen()
    prompt = (BLIND_FORENSIC_PROMPT.format() if fake_score is None
              else FORENSIC_PROMPT.format(fake_score=fake_score))
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
    for attempt in range(MAX_RETRIES):
        # Greedy decoding is deterministic, so a bare retry after a parse
        # failure would just reproduce the same broken output — sample on
        # retries to actually get a different generation.
        gen_kwargs = {"max_new_tokens": MAX_NEW_TOKENS}
        if attempt > 0:
            gen_kwargs.update(do_sample=True, temperature=0.7)

        output = model.generate(**inputs, **gen_kwargs)
        # Only decode the newly generated tokens, not the echoed prompt.
        new_tokens = output[:, inputs["input_ids"].shape[1]:]
        text = processor.batch_decode(new_tokens, skip_special_tokens=True)[0]
        last_raw = text

        parsed = _parse_json(text)
        if parsed is not None:
            return parsed

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
