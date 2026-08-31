# VeraLens

VeraLens decides whether a photograph of a face was synthetically generated, and explains that decision in natural language. The contribution is the integration architecture and explainability pipeline built around a pretrained classifier — not the classifier itself.

## Detection

**Face Crop**:
The 224×224 region containing one detected face, produced by InsightFace. The only input the classifier ever sees.
_Avoid_: thumbnail, ROI, patch

**Fake Probability**:
A scalar in [0,1] expressing how synthetic a Face Crop appears. Always oriented toward fake, never toward the predicted class — a confident REAL is a Fake Probability near 0, not near 1.
_Avoid_: confidence, score, fake_score, final_confidence

**Verdict**:
The categorical outcome — REAL or FAKE — obtained by thresholding a Fake Probability.
_Avoid_: prediction, label, result

**Saliency Map**:
The Grad-CAM overlay showing which regions of a Face Crop drove the classifier's Fake Probability.
_Avoid_: attention map, activation map, bare "heatmap"

**Fusion**:
Combining the classifier's Fake Probability with the reasoning layer's independent Verdict into one final judgement.
_Avoid_: ensemble, voting, blending

## Data

**Training Split**:
The 90% of the dataset the classifier learned from. Fixed by a seeded shuffle at training time.

**Validation Split**:
The 10% withheld from gradient updates but observed during training. It informed the two-phase schedule, so it is **not** an untouched test set and results drawn from it are Validation Performance.
_Avoid_: test set, holdout, unseen data

**Split Manifest**:
The file recording exactly which images belong to which split, so a reported number can be regenerated rather than re-derived by chance.

**Leaked Image**:
A Validation Split image that is byte-identical to a Training Split image. The dataset contains duplicates and the split shuffles rather than deduplicates, so 413 of 3,212 are leaked. Excluded from reported metrics.

**Leakage-Free Subset**:
The Validation Split with every Leaked Image removed — 2,799 images. The only data the classifier is measured on.

**Class Balance**:
The dataset is 16,060 real and 16,060 fake Face Crops. Splits are expected to preserve this roughly 50/50 ratio.

## Evaluation

"Evaluation" alone is ambiguous here — it names two independent axes that share no code, no data, and no metrics. Always qualify it.

**Detection Metrics**:
How well the system separates real from fake — accuracy, AUC, precision, recall, F1, confusion matrix, ROC. Measured against ground-truth labels.
_Avoid_: bare "evaluation", performance, results

**Explanation Quality**:
How good the generated natural-language reasoning is — scored by the Judge and by ROUGE against references. Independent of whether the Verdict was correct.
_Avoid_: bare "evaluation", accuracy

**Judge**:
The external model that scores Explanation Quality against a rubric. Evaluation-only, never on the inference path.

**Ablation Arm**:
One of the three configurations compared to isolate the reasoning layer's contribution — **Vision-Only** (classifier alone), **LLM-Only** (reasoning layer alone), **Fused** (both, combined by Fusion).
_Avoid_: baseline, condition, variant

**Validation Performance**:
Detection Metrics computed on the Leakage-Free Subset. The strongest claim this project's data supports; distinct from test performance, which was never measured.
