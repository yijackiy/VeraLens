# Explanation Quality is re-judged by Gemini 3.8 Flash

ADR 0007 recorded that step 4.4 ran on the on-device judge, which reuses the
Qwen3-VL-2B weights that wrote the explanations, so every reported judge score
was an optimistic bound. The judge interface was built so that fixing this
would be a config change. We made it: all 563 explanations (372 blind, 191
production) were re-scored by Gemini 3.8 Flash, a model that wrote none of
them, on a prepaid API account. The local judge's rows stay in the table and
are reported beside the Gemini rows, never pooled with them.

The original plan named Gemini 2.5 Flash. By November 2026 Google's docs list
2.5 as available only to accounts that had already used it, and recommend 3.8
Flash for new projects, so we used 3.8 Flash. The rubric (`v1`), temperature
(0), and schema are unchanged.

## What changed in the judge call

- **Thinking.** 3.x models always think and have no off switch; the 2.5-era
  `thinking_budget=0` is not supported. We set `thinking_level="low"`, the
  lowest level the docs list. Thinking tokens still count against the output
  budget.
- **Version recorded.** The API returns `gemini-3.8-flash` as its
  `model_version`, which is the alias we asked for, not a dated snapshot. If
  Google repoints the alias, these scores could not be reproduced by name. The
  date of the run (5 November 2026) is the only pin.
- **Cost and quota.** Prepaid, no auto-reload. Client-side limits were raised
  to `JUDGE_RPM=30` and `JUDGE_DAILY_QUOTA=800`; the run used 563 attempts, no
  retries, and took about 25 minutes. The project's "budget 0 EUR" no longer
  holds for the judge step. Actual spend was not measured here; the estimate
  before the run was $1–$2.
- **Storage.** `summary()` and `calls_today()` are now scoped by provider.
  Before this, a Gemini run would have been averaged together with the 429
  local rows. `compare_informed.py` and `report_results.py` are scoped the same
  way, and the Gemini comparison is written to its own file.

## Results

Gemini 3.8 Flash, 563 scored, 0 failed. Mean 3.542 over everything; per arm:

| Corpus | Fake | Real |
| --- | --- | --- |
| Blind (n = 372) | 2.24 | 4.46 |
| Production (n = 191) | 2.95 | 4.92 |

Paired on the 177 images scored in both modes:

| Class | n | Delta | Better / worse / same | Sign-test p |
| --- | --- | --- | --- | --- |
| Fake | 88 | +0.68 | 48 / 3 / 37 | < 0.0001 |
| Real | 89 | +0.40 | 12 / 3 / 74 | 0.0352 |
| All | 177 | +0.54 | 60 / 6 / 111 | < 0.0001 |

For comparison the local judge gave +0.91 on fakes (p = 0.0015, n = 57) and
−0.02 on reals (p = 1.0, n = 56), on a smaller paired set because it scored
only 425 of the corpus.

**Agreement between the two judges**, on the 421 explanations both scored:
identical score on 51.8%, within one point on 77.9%, Spearman ρ = 0.716. The
means are almost the same (3.603 local, 3.627 Gemini).

## What this supports, and what it does not

- **Supported:** the explanation-quality result no longer depends on a judge
  grading its own author. With an independent judge the production
  configuration still scores significantly higher on fakes. The effect is
  smaller than the local judge's (+0.68 against +0.91) but in the same
  direction and clearly significant.
- **New and weaker:** Gemini finds a gain on reals (+0.40, p = 0.035) that the
  local judge did not. It rests on 15 images that moved, sits against a ceiling
  (real mean 4.46 to 4.92 out of 5), and is one of three tests. Report it as
  suggestive, not as a finding.
- **Rubric shape:** Gemini's scores are nearly bimodal (1: 54, 2: 85, 3: 174,
  4: 2, 5: 248). The rubric almost never produces a 4, so means hide a
  discrete 1/2/3/5 scale. Say so next to any mean.
- **Not supported:** anything about detection. Nothing here changes ADR 0005:
  the reasoning layer is not claimed to improve detection accuracy.
- **Reproducibility is narrower than it sounds.** Scores were identical across
  three repeats on five explanations (a small check, not a proof), but the
  explanations themselves are one unseeded draw of a sampling model (ADR 0013),
  and the model version is an alias. "Reproducible judge" does not mean
  "reproducible result".
- **Still true from ADR 0007:** the explanations are graded against
  label-level ground truth (ADR 0006), which limits how much any judge can
  assess specific artefact claims.

## Data location

Rows are in the local SQLite file `data/judge.db`. The project notes say final
results belong in Neon or Supabase through `DATABASE_URL`; that was not done
for this run. A backup of the local judge's rows was taken before the Gemini
run (`backups/judge_scores_20261105T110453Z.jsonl`); back up the Gemini rows
too before submission.
