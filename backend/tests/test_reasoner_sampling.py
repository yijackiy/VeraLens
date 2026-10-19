"""
The reasoning layer samples, on every attempt, with the values written in
reasoner.SAMPLING — not with whatever the model's generation_config.json
happens to say.

This used to be untrue in a way nobody could see: the code claimed the first
attempt was greedy and never set do_sample, so every attempt silently
inherited sampling from a JSON file in the Hugging Face cache (ADR 0013). The
model is mocked here; what is under test is which arguments reach generate().
"""
import torch
from PIL import Image

from backend.app.llm import reasoner

GOOD = (
    '{"verdict": "fake", "confidence": 0.9, "signals": '
    '[{"name": "skin texture consistency", "severity": 0.8, "note": "n"}], '
    '"explanation": "A sentence."}'
)


class _Inputs(dict):
    def to(self, _device):
        return self


class _FakeProcessor:
    def __init__(self, replies):
        self.replies = list(replies)

    def apply_chat_template(self, *_args, **_kwargs):
        return _Inputs(input_ids=torch.zeros((1, 4), dtype=torch.long))

    def batch_decode(self, *_args, **_kwargs):
        return [self.replies.pop(0)]


class _FakeModel:
    device = "cpu"

    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append({k: v for k, v in kwargs.items() if k != "input_ids"})
        return torch.zeros((1, 8), dtype=torch.long)


def _run(monkeypatch, replies):
    model, processor = _FakeModel(), _FakeProcessor(replies)
    monkeypatch.setattr(reasoner, "load_qwen", lambda: (model, processor))
    result = reasoner.run_reasoning(Image.new("RGB", (224, 224)), fake_score=0.95)
    return model.calls, result


def test_the_first_attempt_samples(monkeypatch):
    calls, result = _run(monkeypatch, [GOOD])
    assert len(calls) == 1
    assert calls[0]["do_sample"] is True
    assert result["verdict"] == "fake"


def test_every_attempt_uses_the_same_written_down_values(monkeypatch):
    # Two unparseable replies, then a good one: three attempts, one Draw.
    calls, result = _run(monkeypatch, ["not json", '{"foo": 1}', GOOD])
    assert len(calls) == 3
    for call in calls:
        for key, value in reasoner.SAMPLING.items():
            assert call[key] == value, (key, call)
    assert result["verdict"] == "fake"


def test_the_values_are_the_ones_the_evaluation_ran_under():
    # What generation_config.json of snapshot 89644892 ships, and therefore
    # what every reported Explanation Quality number was drawn with. Changing
    # this is changing what those numbers describe — do it on purpose.
    assert reasoner.SAMPLING == {
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.8,
        "top_k": 20,
    }
