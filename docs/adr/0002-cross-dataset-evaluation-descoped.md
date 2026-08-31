# Cross-dataset generalization evaluation is descoped

`veralens_project_context_and_plan.md` asks for accuracy and AUC on FaceForensics++ and CelebDF-v2 as a generalization check. Both are video datasets, so using them requires frame extraction via FFmpeg — which the project explicitly cut when it fixed photo-only scope. Both also sit behind manually approved access requests that take days to weeks, against a 31 August deadline. We therefore report in-distribution Validation Performance only, and record the absence of cross-dataset evidence as the thesis's primary limitation.

## Consequences

- The plan document and the scope boundary in `CLAUDE.md` contradict each other on this point; the plan predates the video-scope cut and was never reconciled. This ADR resolves the contradiction in favour of the scope boundary.
- Deepfake detectors are known to degrade sharply on unseen generators, so in-distribution metrics alone should not be presented as evidence of real-world detection strength. The write-up states this explicitly rather than leaving it inferred.
- Cross-dataset evaluation is the clearest direction for future work. Reopening it means either accepting video scope, or sourcing an image-based benchmark that avoids frame extraction entirely.
