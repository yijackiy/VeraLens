"""
The reasoning layer says where it is while it writes.

Writing the explanation is nearly all of a 40-second-to-3-minute wait, so it is
the stage the interface most needs to say something true about. The model is
mocked, as in test_reasoner_sampling.py; what is under test is what reaches
generate() and what is reported along the way — and, just as important, that
adding the streamer did not touch the sampling the reported numbers came from.
"""
import pytest
import torch
from PIL import Image

from backend.app import progress
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
    """Like generate(): hands the streamer the prompt once, then one new token
    per step."""
    device = "cpu"

    def __init__(self, tokens_per_attempt=3):
        self.tokens_per_attempt = tokens_per_attempt
        self.kwargs = []

    def generate(self, **kwargs):
        self.kwargs.append({k: v for k, v in kwargs.items() if k != "input_ids"})
        streamer = kwargs.get("streamer")
        if streamer is not None:
            streamer.put(kwargs["input_ids"])
            for _ in range(self.tokens_per_attempt):
                streamer.put(torch.zeros((1,), dtype=torch.long))
            streamer.end()
        return torch.zeros((1, 8), dtype=torch.long)


@pytest.fixture
def reports(monkeypatch):
    seen = []
    monkeypatch.setattr(progress, "report", lambda stage, **detail: seen.append((stage, detail)))
    return seen


def _run(monkeypatch, replies, model=None):
    model = model or _FakeModel()
    monkeypatch.setattr(reasoner, "load_qwen", lambda: (model, _FakeProcessor(replies)))
    result = reasoner.run_reasoning(Image.new("RGB", (224, 224)), fake_score=0.95)
    return model, result


def test_a_streamer_reaches_generate(monkeypatch, reports):
    model, _ = _run(monkeypatch, [GOOD])
    assert model.kwargs[0]["streamer"] is not None


def test_the_streamer_did_not_change_the_sampling(monkeypatch, reports):
    model, _ = _run(monkeypatch, [GOOD])
    for key, value in reasoner.SAMPLING.items():
        assert model.kwargs[0][key] == value
    assert model.kwargs[0]["max_new_tokens"] == reasoner.MAX_NEW_TOKENS


def test_loading_is_reported_before_writing(monkeypatch, reports):
    _run(monkeypatch, [GOOD])
    stages = [stage for stage, _ in reports]
    assert stages[0] == "loading"
    assert "writing" in stages
    assert stages.index("loading") < stages.index("writing")


def test_tokens_are_counted_from_the_first_new_token_not_the_prompt(monkeypatch, reports):
    _run(monkeypatch, [GOOD], model=_FakeModel(tokens_per_attempt=3))
    counts = [d["tokens"] for stage, d in reports if stage == "writing"]
    # 0 when the attempt starts, then 1, 2, 3 — the 4 prompt tokens never show.
    assert counts == [0, 1, 2, 3]


def test_a_retry_is_reported_as_the_next_attempt(monkeypatch, reports):
    # Two unreadable replies and then a good one: the wait nobody can explain
    # from the outside is the one with a second and third attempt inside it.
    _run(monkeypatch, ["not json", '{"foo": 1}', GOOD], model=_FakeModel(tokens_per_attempt=1))
    attempts = sorted({d["attempt"] for stage, d in reports if stage == "writing"})
    assert attempts == [1, 2, 3]
    assert all(d["max_attempts"] == reasoner.MAX_RETRIES for stage, d in reports if stage == "writing")


def test_counts_restart_for_every_attempt(monkeypatch, reports):
    _run(monkeypatch, ["not json", GOOD], model=_FakeModel(tokens_per_attempt=2))
    second = [d["tokens"] for stage, d in reports if stage == "writing" and d["attempt"] == 2]
    assert second == [0, 1, 2]


def test_nothing_is_reported_outside_a_tracked_analysis(monkeypatch):
    # The evaluation scripts run this same function with no request around it.
    # (progress.report is real here, and has no current Analysis to land on.)
    _run(monkeypatch, [GOOD])
    assert progress._state == {}
