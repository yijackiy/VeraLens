# VeraLens

VeraLens decides whether a photograph of a face was synthetically generated, and explains that decision in natural language. The contribution is the integration architecture and explainability pipeline built around a pretrained classifier — not the classifier itself.

## Detection

**Submitted Photo**:
The complete photograph a person hands to VeraLens, before any face detection — chosen from a file or captured with the camera. One term covers both sources deliberately: the pipeline cannot distinguish them, and a Submitted Photo that never yields a Face Crop is not a Verdict of REAL, it is nothing at all.
_Avoid_: upload, input image, source image, selfie

**Face Candidate**:
One face InsightFace found in a Submitted Photo, before anything has been classified. A photo yields as many Face Candidates as it has faces; exactly one of them becomes the Face Crop. The distinction is what makes choosing a face possible rather than a re-run — a Face Candidate costs nothing to discard, because nothing has been spent on it yet.
_Avoid_: detection, box, bbox, face option, candidate face

**Face Crop**:
The 224×224 region containing one detected face, produced by InsightFace. The only input the classifier ever sees. There is one per Analysis, whoever picked it — a Face Crop chosen by hand and one taken by default are the same object.
_Avoid_: thumbnail, ROI, patch, chosen face, analysed face

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

**Analysis**:
One complete run of the pipeline over one Submitted Photo, and everything it produced — the Face Crop, the Fake Probability, the Verdict, the Saliency Map and the written explanation. The glossary above names the parts; this is the whole. A Submitted Photo that yields no Face Crop produces no Analysis. Its Verdict and explanation come from its first Draw; later Draws add evidence about that Verdict without replacing it.
_Avoid_: result, report, scan, detection

**Draw**:
One run of the reasoning layer against an Analysis's fixed Face Crop, counting its internal parse retries as part of the one Draw. The reasoning layer samples, so two Draws of the same face can cite different signals, word the explanation differently, or fail to produce one at all. Only the reasoning layer's contribution differs between Draws; a Draw whose classifier Fake Probability differs from its Analysis's is not a Draw of that Analysis.
_Avoid_: re-run, sample, retry, attempt, replicate

**Held Analysis**:
The one Analysis parked aside while a second photo is submitted, so the two can be read together. Exactly one is ever held; it lives in the browser for as long as the tab does and is never stored. Holding is what turns the next submission into the second half of a Comparison rather than a fresh start.
_Avoid_: pinned, saved, bookmarked, first result, photo 1

**Comparison**:
Two Analyses read against one shared Fake Probability scale. The distance between them is a distance and nothing more — it supports no ranking, and neither Analysis becomes more certain for having been placed next to another.
_Avoid_: ranking, versus, diff, A/B test, score comparison

**Explanation Register**:
Which of the two presentations of one Analysis is showing: **Plain**, what the reasoning layer said in its own words, or **Technical**, every measurement behind the Verdict. Plain is a strict reduction of Technical — nothing appears in Plain that Technical omits — and neither register changes a Verdict, a Fake Probability, or the disclosure of who wrote the explanation.
_Avoid_: mode, view, detail level, expert mode

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
