# The technical register is measurements, not generated prose

The Explanation Register offers a Plain and a Technical presentation of one
Analysis. The obvious way to build Technical is to ask Qwen3-VL for a second,
more forensic paragraph alongside the plain one — a second field in the same
JSON, or a second call. We did not, and Technical contains no text the model
wrote for it.

A 2B model asked for forensic register will supply it. It will write that skin
micro-texture shows attenuated high-frequency noise across the malar region, or
that the estimated key-light azimuth departs from the background gradient by
roughly thirty degrees. It cannot measure either. What the register would buy is
fluent invented precision, and it would buy it on the one screen whose entire
purpose is to be trusted — while ADR 0005 already rests the thesis claim on
explanation quality rather than on detection.

So the two registers divide differently. Plain shows what the reasoning layer
said. Technical shows what was measured: the classifier's Fake Probability, the
reasoning layer's recovered probability, the 0.55/0.45 weights, the threshold,
the per-signal severities, the crop size, the elapsed time, and the three models
that ran. Every one of those is a number the system holds; none of them is
generated at display time.

There is a second consequence that made the decision easy. `prompts.py` already
specifies `"explanation": "2-3 sentence plain-English summary"`, so the existing
output is the Plain register — Technical was the half that did not exist. And
`reasoner.py` reports a parse failure on roughly one photo in twenty as it
stands; a second prose field is a second thing for the schema to get wrong.

## Consequences

- Nothing in the inference path changes. No prompt edit, no second call, no
  extra 40 seconds, no new parse-failure surface, and the backend is untouched
  by this feature entirely.
- Technical is today's verdict screen unchanged, plus the model names. Plain is
  the new thing, and it is a reduction: the severity chips, the threshold and
  crop tiles, the weight rows and the recovered reasoning percentage all leave.
  Plain therefore defaults on, which does change what an existing user sees.
- The disclosure that a model wrote the explanation after being told the verdict
  is reworded between registers and removed from neither. Plain language is a
  reason to disclose more readably, not less; both versions state that a model
  wrote it, that it was told the verdict first, and that it is not independent
  evidence.
- If a future version does generate a technical paragraph, it needs its own
  Explanation Quality measurement before it ships. The Judge currently grades
  one register, and a second one written in a more authoritative voice is
  exactly the kind of text a rubric scores well and a reader should not trust.
- `MODELS` in `lib/register.js` is a hand-maintained list displayed as fact on a
  verdict page. Nothing connects it to what the backend actually loaded.
