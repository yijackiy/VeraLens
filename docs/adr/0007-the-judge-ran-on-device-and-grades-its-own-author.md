# The judge ran on-device, and grades its own author

The default judge is Gemini 2.5 Flash, but no `GEMINI_API_KEY` is configured and
the free tier's 250 calls/day is below the 372-explanation corpus in any case.
With the deadline reached, step 4.4 ran under `JUDGE_PROVIDER=local`, which is
the on-device fallback the judge interface was built for. That fallback reuses
the Qwen3-VL-2B weights already on disk — the same model that wrote the
explanations being graded.

## Consequences

- **The judge is grading its own output.** Self-evaluation is a known bias:
  models tend to rate text in their own style and from their own distribution
  more favourably than an independent grader would. The reported mean score is
  therefore an optimistic bound, and the thesis must say so rather than
  presenting it as an independent assessment.
- A 2B judge is also simply weaker at grading than the 2.5 Flash it stands in
  for, so scores are noisier as well as biased.
- Re-running under Gemini is a config change, not a rewrite — that is what the
  `IJudge` interface was for (ADR: step 4.4a). Scores are cached on
  hash(rubric + input + model + temperature), so a Gemini run recomputes rather
  than colliding with the local scores, and both can be reported side by side.
  Doing so needs an API key in `.env` and two days of free-tier quota for 372
  explanations, or a reduced sample.
- The corpus was scored only in part: 234 of 372. The run first hit the
  `JUDGE_DAILY_QUOTA=250` guard, which is right for the Gemini free tier and
  meaningless for an on-device judge, and every attempt to score the remainder
  then died with a segfault while loading the model (exit 139), reproducibly,
  on a machine that has hit this before. The scored portion is class-balanced
  (116 fake, 114 real) and the corpus is in the ablation's shuffled order, so
  it is an unbiased sample rather than a truncated one. Report n, not 372.
- Reproducibility conditions still hold on the local path: temperature 0,
  schema-constrained output, the resolved model version recorded per row,
  append-only storage, failures stored as failures.
