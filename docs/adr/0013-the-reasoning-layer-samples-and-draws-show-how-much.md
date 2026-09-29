# The reasoning layer samples, and Draws show how much

Qwen3-VL has sampled on every call VeraLens has ever made. Its
`generation_config.json` ships `do_sample: true, temperature: 0.7, top_p: 0.8,
top_k: 20`, `reasoner.py` never set `do_sample`, and `generate()` inherits
whatever it is not told. The code said otherwise — a comment described the
first attempt as greedy and deterministic, with sampling reserved for retries —
and nothing on the reasoning path was ever seeded. Nobody noticed because
nobody had submitted the same photo twice and compared.

We keep sampling, write the values into `reasoner.SAMPLING` instead of
inheriting them, pin the model snapshot, disclose what it means for the
reported results, and add Draws: a way to ask the reasoning layer again about
the same face and see what changes.

## What this means for the reported results

**Unaffected — deterministic, classifier only:** Detection Metrics (accuracy
0.9750, AUC-ROC 0.9973, macro F1 0.9750 on the Leakage-Free Subset) and the
Vision-Only ablation arm.

**One unseeded draw, not bit-reproducible:** the LLM-Only arm (0.6625), the
Fused arm (0.9825), McNemar p = 0.6250, and every Explanation Quality figure —
ROUGE-1 0.3554, distinct-1 0.0203, judge mean 3.591, and the project's one
positive result, +0.91 on fakes with sign-test p = 0.0015. Re-running
`evaluate_ablation.py` would not reproduce these exactly. The judge itself is
temperature 0 and reproducible; what it graded is not.

**Why the aggregates are probably stable — an argument, not evidence.** Each
figure averages over hundreds of images, which damps per-draw noise; the fused
arm is dominated by the deterministic classifier at weight 0.55; and on the
production prompt the reasoning layer agreed with the classifier on all 191
parsed draws, so its contribution to the Verdict barely moves. A large paired
effect like +0.91 is unlikely to reverse under resampling. None of that has
been measured. Re-running the explanation slice behind +0.91 for two more
draws, and reporting the spread, would turn this paragraph into a number; it
was not done.

## Considered options

**Switch to greedy decoding.** Stable per photo, and the obvious reading of
"make it reproducible". Rejected because every reported Explanation Quality
number was drawn under sampling: switching would quietly make the shipped app a
different system from the one measured, and re-measuring costs hours of GPU per
configuration. Small models also tend to loop under greedy, and distinct-1 is
already 0.0203.

**Keep sampling and record a seed per Analysis.** Same distribution, and each
Analysis would become replayable. Deferred: bitsandbytes 4-bit kernels are not
guaranteed deterministic on CUDA even with a fixed seed, and that is untested
on this card. Recording a seed that does not replay would be a false promise.
Worth trying if replayability is ever wanted — test it first.

**Leave the values inherited.** They are the same numbers either way, but a
value that lives only in a cached JSON file is not a decision anyone made, and
`from_pretrained` had no `revision=`: a Docker rebuild, a Colab run or a
cleared cache would fetch whatever upstream had published, and the demo would
stop being the system that was measured with no code change to show for it.
`model.py` now pins snapshot `89644892e4d85e24eaac8bacfd4f463576704203`.

## Draws

A **Draw** is one run of the reasoning layer against an Analysis's fixed Face
Crop, its internal parse retries included. Draw 1 is the Analysis itself;
later Draws add evidence about its Verdict and never replace it. Aggregating
Draws into a Verdict was rejected for the same reason as greedy decoding: the
Verdict would become a function of how many times someone clicked, and would
stop corresponding to the single-draw numbers reported above.

**A Draw re-submits the photo** through `/detect` and `/analyze` with the
Analysis's `face_index`, skipping the picker. The upload is gone after
`/analyze` (ADR 0012), so the alternative was a second server-side store
holding the Face Crop for a draw-only endpoint — a second leak on abandonment,
for a saving of a few seconds against a minute of generation. Re-submission
re-runs the detector and classifier, both deterministic, so a result only
counts as a Draw of the Analysis if its classifier score matches to within
1e-4 (not exactly: cuDNN is not set deterministic, and the classifier on GPU
can differ around the seventh decimal). A result that does not match is shown
and left out. In a draw-only endpoint that property would hold by
construction; here it is checked on every Draw, which is the stronger thing to
be able to say.

**What a Draw can show was measured before it was designed**, from the 200
production-prompt records in `results/ablation_records_informed.jsonl`:

- The reasoning layer agreed with the classifier on **191 of 191** parsed
  draws; **9 of 200 (4.5%)** did not parse. Only **5 of 200 (2.5%)** images
  have a classifier score where a disagreeing draw could flip the fused
  Verdict. Verdict changes will be rare.
- Every parsed draw returned **exactly the five checklist signals, verbatim —
  955 of 955**. Which signals a Draw cites carries no information. Only their
  severities, notes and the explanation text can differ, so Draws compare
  severities per signal and do not compare signal lists.
- Severities cluster on 0.6 / 0.7 / 0.8 (109 / 201 / 232 of 955), and the
  High/Medium edge in `severityBand` is 0.7. Band changes would report the
  model's routine 0.1 jitter as a change, so they are not the rule.

**A signal counts as moved when its severities span 0.3 or more across Draws.
0.3 is a chosen threshold, not a measured one** — there is no ground truth here
for "a meaningfully different severity". It governs only the plain-language
sentence; the technical register shows every raw value, so a reader can apply
their own. The comparison uses an epsilon, because 0.7 − 0.4 and 0.95 − 0.65
both fall just short of 0.3 in floating point and the model uses all four
values.

No text-similarity score between Draws' explanations is shown. With distinct-1
at 0.0203 the explanations are mostly the recited checklist, so ROUGE between
two Draws would read high even when the severities underneath had swung —
reporting "stable" for exactly the case Draws exist to catch.

When nothing moved, the page says **"that's consistency, not confirmation:
each time, it was told what the classifier had found."** Every Draw sees the
classifier's verdict in words (ADR 0008), so stable severities may be a stable
echo of it.

## Consequences

Two submissions of the same photo have always been able to produce different
explanations, and now the interface says so. A demo that runs one photo twice
will show it; that is the point.

Each Draw writes one more Saliency Map PNG into the un-swept heatmap directory
(ADR 0012's accepted gap), so the directory now grows faster.
