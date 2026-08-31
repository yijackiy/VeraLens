# Detection Metrics come from the recovered Validation Split, not a held-out test set

The 4 August training run reported its numbers to stdout and saved no metrics, no logs, and no Split Manifest — only the checkpoint at `backend/models/effnb4_deepfake.pt` survived. `build_splits()` produces only a train/validation pair, so no untouched test set was ever created. Rather than retrain (forbidden by project scope) or invent a new split (which the checkpoint has already seen 90% of), we regenerate the original split by re-running the same seeded shuffle, persist it as a Split Manifest, and report Validation Performance from it.

## Considered Options

- **Retrain with a proper three-way split.** Rejected: no-classifier-retraining is a fixed project constraint, and two days remain before the deadline.
- **Carve a test set out of the data now.** Rejected: the checkpoint trained on 90% of the dataset, so any new split is contaminated except for the existing validation portion — which is what we already use.
- **Report the `97.82% / 0.9976` figures recorded in a session handoff.** Rejected: no methodology, split, or script stands behind them, so they are not citable.

## Consequences

- The Validation Split informed the two-phase training schedule, so it is not statistically pristine. Model selection was never automated against it (training saves the final epoch, not the best-val checkpoint), so contamination is weak — but the thesis must report these as Validation Performance and name the absent test set as a limitation.
- Split recovery is verifiable: the folders under `data/deepfake_faces/` have not changed since 1 August, before the checkpoint was written, so the seeded shuffle should reproduce exactly. If evaluation reproduces roughly 97.82% accuracy and 0.9976 AUC, that confirms both the recovery and the handoff figure. A mismatch means recovery failed and nothing should be cited.
- The three-arm Ablation runs on an 800-image stratified subsample rather than the full split, because it needs VLM inference per image (hours, on hardware that has already hit OOM) instead of the classifier's minutes. The sample is shuffled up front and written incrementally, so any stopping point remains an unbiased sample and a crash costs minutes rather than the run.
