import torch
from transformers import (
    BitsAndBytesConfig,
    Qwen3VLForConditionalGeneration,
    Qwen3VLProcessor,
)

MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"

# The snapshot every reported number came from. Unpinned, a Docker rebuild,
# a Colab run or a cleared cache would fetch whatever upstream published that
# day — weights, processor and generation defaults — and the app being demoed
# would stop being the system that was measured, with no code change to show
# for it (ADR 0013).
MODEL_REVISION = "89644892e4d85e24eaac8bacfd4f463576704203"

_model = None
_processor = None


def load_qwen():
    """
    Lazy-loads Qwen3-VL-2B in 4-bit (fits the 4GB GTX 1650 VRAM budget).
    Reuses the same model/processor instance on subsequent calls.
    Returns (model, processor).
    """
    global _model, _processor
    if _model is not None:
        return _model, _processor

    bnb_config = BitsAndBytesConfig(load_in_4bit=True)
    _processor = Qwen3VLProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    _model = Qwen3VLForConditionalGeneration.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        torch_dtype=torch.float16,
        quantization_config=bnb_config,
        device_map="cuda:0",
    )
    print(f"[llm] loaded {MODEL_ID}. VRAM used (MB):",
          torch.cuda.memory_allocated() / 1e6)
    return _model, _processor


if __name__ == "__main__":
    load_qwen()
