# The classifier's verdict is given to the VLM in words, not as a number

`FORENSIC_PROMPT` interpolates the classifier's fake-probability as a bare
numeral ("a fake-probability score of 0.99"). Qwen3-VL-2B copies that numeral
straight into its own `confidence` field rather than forming a judgement: on
the first four images tested, the returned confidence equalled the injected
score every time (0.99, 0.00, 1.00, 0.00), producing incoherent rows such as
verdict `fake` with confidence 0.0, and verdict `real` at 0.99 on an image the
classifier scored 0.9939 fake. Accuracy collapsed to 1/4, against 4/4 for the
same model run blind. `GUIDED_FORENSIC_PROMPT` states the finding
qualitatively ("very likely MANIPULATED") and says explicitly that confidence
means the model's own certainty. On the smoke test that restored 5/6 correct
with no echoing, and over 200 images it raised judged Explanation Quality on
fake images from 2.23 to 3.03 (paired, +0.91, sign test p = 0.0015).

## Consequences

- **This bug is live in production.** `backend/app/api/main.py` still serves
  `FORENSIC_PROMPT`, so every explanation the app has produced carries a
  confidence copied from the classifier. `fuse()` consumes that field, so the
  fusion layer has been weighting a corrupted signal — its `llm_fake_prob` is
  a function of the classifier's own score, not an independent opinion.
  Switching production to the guided prompt is a one-line change and is
  recommended; it is left as an explicit decision rather than made silently.
- The measured ablation is unaffected: it ran blind, and blind never
  interpolates a score.
- Numeric anchoring of this kind is a property of small instruction-tuned
  models, not of this prompt alone. Any future value passed into a prompt —
  a threshold, a confidence, a count — should be expected to leak into the
  output unless it is described rather than stated.
- Side effects beyond the score: unparseable VLM output fell from 7.0% to 4.5%,
  and judge calls on the guided corpus failed 0 times against 4 on the blind
  one. Removing the numeral appears to make the whole response better formed.
- The four broken-prompt records are kept at
  `results/ablation_records_informed_BROKEN_PROMPT.jsonl.bak` as the evidence
  for this ADR.
