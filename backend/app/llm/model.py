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


def _from_cache_first(cls, **kwargs):
    """
    from_pretrained, from disk if the pinned snapshot is already there.

    A pinned revision still costs a request to the Hub on every load, so a
    demo with no network would fail at the reasoning step on a machine that
    has every byte it needs. Only a missing snapshot goes online — the first
    run on a fresh machine or container.
    """
    try:
        return cls.from_pretrained(MODEL_ID, revision=MODEL_REVISION,
                                   local_files_only=True, **kwargs)
    except OSError:
        print(f"[llm] {MODEL_ID}@{MODEL_REVISION[:8]} not cached — downloading")
        return cls.from_pretrained(MODEL_ID, revision=MODEL_REVISION, **kwargs)


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
    _processor = _from_cache_first(Qwen3VLProcessor)
    _model = _from_cache_first(
        Qwen3VLForConditionalGeneration,
        torch_dtype=torch.float16,
        quantization_config=bnb_config,
        device_map="cuda:0",
    )
    print(f"[llm] loaded {MODEL_ID}. VRAM used (MB):",
          torch.cuda.memory_allocated() / 1e6)
    return _model, _processor


if __name__ == "__main__":
    load_qwen()
