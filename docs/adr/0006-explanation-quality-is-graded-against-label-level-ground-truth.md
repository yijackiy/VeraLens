# Explanation Quality is graded against label-level ground truth

Steps 4.3 and 4.4 both assume a reference: ROUGE needs human-written
explanations to compare against, and the judge rubric grades an explanation
against the artefacts actually present. `pujanpaudel/deepfake_face_classification`
supplies neither — it carries real/fake labels and no artefact-level annotation
saying *which* forensic trace betrays a given fake. Rather than invent per-image
signal lists, the corpus asserts only what is known: for a real image, that no
manipulation artefacts are present; for a fake, that manipulation is present and
the artefact type is unannotated. ROUGE is computed against canonical
descriptions written for this project and labelled as such wherever it appears.

## Consequences

- The judge grades whether an explanation is *consistent with the known label
  and forensically plausible*, not whether it named the correct artefact. That
  is a weaker claim than the build guide assumed and the write-up must state it.
- ROUGE here measures vocabulary alignment with expected forensic phrasing, not
  correctness. A high score would mean the model writes like the reference, not
  that it saw what the reference describes. Reported because step 4.3 asks for
  it, never presented as a correctness measure.
- The reference-free metrics in `scripts/evaluate_explanations.py` carry more
  weight for the thesis precisely because they need no reference: vocabulary
  diversity, within-class self-overlap, and how often each prompted forensic
  signal is named. Boilerplate is detectable without ground truth.
- Obtaining artefact-level annotations, by hand on a small subset or from a
  dataset that ships them, is the fix. Recorded as future work.
- 28 of the 400 explanations came from unparseable VLM verdicts and carry a
  placeholder rather than reasoning. They are excluded from the corpus: judging
  them would score the error handling, not the reasoning layer.
