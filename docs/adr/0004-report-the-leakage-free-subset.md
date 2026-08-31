# Headline Detection Metrics come from the leakage-free subset

Hashing the dataset turned up 1,042 groups of byte-identical duplicate images
within the class folders. Because `build_splits()` shuffles files rather than
deduplicating them, 413 of the 3,212 Validation Split images (12.86%) have an
identical twin in the Training Split — the classifier was scored on images it
had already learned. We therefore report Detection Metrics on the 2,799 images
with no training twin, and quote the full-split figures only as the historical
comparison that confirms split recovery.

This supersedes nothing in
[0001](0001-metrics-from-recovered-validation-split.md); it narrows which
images that ADR's recovered split is scored on.

## Consequences

- Headline Validation Performance is accuracy 0.9750, AUC 0.9973 (2,799
  images), against 0.9782 / 0.9976 on the full 3,212. The 0.32 point gap is
  small, so the leakage inflated the result only slightly — worth stating
  plainly, since a reader who finds the duplicates independently will assume
  the worst.
- `scripts/evaluate_ablation.py` samples from the leakage-free pool too. The
  classifier has seen the leaked images and the reasoning layer has not, so
  including them would flatter the Vision-Only arm and understate the
  reasoning layer's contribution.
- The duplicates are a property of the published dataset, not of the
  extraction: no image appears under both labels (0 cross-folder duplicate
  groups), which also clears the earlier suspicion that the `.rar`/`.zip`
  extraction had mis-routed files between `real/` and `fake/`.
- Deduplicating before splitting would be the correct fix, but it requires
  retraining, which project scope forbids. Recorded as future work.
