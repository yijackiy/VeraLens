# The ablation runs the reasoning layer blind

`FORENSIC_PROMPT` embeds the classifier's fake score, so in production the VLM
sees the classifier's answer before writing its own verdict. That is correct for
explanation — the text should account for the score the user is shown — but it
makes the score useless as an independent measurement: an LLM-Only arm that can
read the classifier's answer is not LLM-only, and fusing a verdict derived from
the classifier with the classifier itself double-counts one signal, so any
apparent gain would be an artefact. `scripts/evaluate_ablation.py` therefore
calls `run_reasoning(fake_score=None)`, which selects `BLIND_FORENSIC_PROMPT`:
identical forensic signals and output schema, with the score withheld.

## Consequences

- The Fused arm measures classifier + *independent* reasoning, not the exact
  production configuration. The thesis must describe the ablation this way
  rather than presenting the Fused number as the deployed system's accuracy.
- This is the conservative direction. Blind fusion can only understate the
  production pipeline's agreement with the classifier, so a positive Fused
  result is trustworthy; the arrangement cannot manufacture one.
- It also halves runtime: one VLM generation per image instead of a blind pass
  and an informed pass, which is what makes the run finish in one sitting on a
  GTX 1650.
- `run_reasoning`'s `fake_score` parameter now defaults to `None`. Production
  callers pass it explicitly and are unaffected, but a new caller that forgets
  it will silently get blind behaviour.
