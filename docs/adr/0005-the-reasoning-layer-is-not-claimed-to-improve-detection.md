# The reasoning layer is not claimed to improve detection

The 400-image ablation measured Fused at 0.9825 accuracy against Vision-Only at
0.9775. That +0.0050 gap rests on four discordant images (fusion fixed three,
broke one), McNemar exact two-sided p = 0.6250, and AUC moves the other way
(0.9957 against 0.9983). Split by class, the reasoning layer is right on 78% of
real faces but 48.5% of fake ones — chance — so its 0.6625 headline accuracy
comes from a bias toward answering "real" rather than from detecting
manipulation. We therefore report the ablation as a null result and rest the
thesis claim entirely on the Explanation Quality axis.

## Consequences

- The write-up must not present +0.50 points as an improvement. A reader who
  runs McNemar on the published per-image records would immediately find the
  gap is noise, and that would discredit stronger claims elsewhere.
- This is consistent with the stated research question, which asks whether a
  reasoning layer improves *explainability and trustworthiness*, not accuracy.
  The null detection result narrows the claim rather than contradicting it.
- It promotes steps 4.3 (ROUGE) and 4.4 (Judge) from supporting evidence to the
  thesis's only quantitative support. `results/ablation_records.jsonl` already
  holds 400 real explanations, which is the corpus both steps needed and did
  not previously have.
- The honest framing is available and defensible: fusion is shown not to
  degrade detection (the classifier's accuracy survives contact with a weak
  second opinion) while adding natural-language justification. That is a
  narrower claim than the plan anticipated, and it is the one the data supports.
- A 7.0% unparseable-verdict rate is itself a finding about 2B-parameter VLMs
  under schema constraints on consumer hardware, and is worth reporting rather
  than hiding.
