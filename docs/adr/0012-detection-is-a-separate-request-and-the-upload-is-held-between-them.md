# Detection is a separate request, and the upload is held between them

One submitted photo is now two HTTP requests. `POST /detect` runs InsightFace
alone, returns every Face Candidate it found with a token, and stops. `POST
/analyze` takes that token plus a `face_index` and runs the expensive half —
classifier, Grad-CAM, Qwen3-VL, fusion — on the one face that was chosen. The
server holds the uploaded file on disk between the two, keyed by the token.

The multi-face picker is why. Choosing a face is only meaningful *before*
anything has been classified; after an Analysis exists, picking a different
face is a re-run, and a re-run costs a minute at the median and closer to three
at p90 on this hardware. Detection
is ~0.2s on CPU (ADR 0011), so splitting the pipeline at that seam buys a
choice for almost nothing.

## Considered options

**Send the photo twice** — detect on the first request, discard, re-upload for
analysis. Stateless, and the obvious thing. Rejected because it makes the user
pay the upload twice for the privilege of choosing, and because the second
detection pass could in principle return different boxes than the one the
picker drew, so the index the browser sends would refer to a list the server
no longer has.

**Return the crops themselves** and have the browser send back the one it
wants. Stateless too, but it moves N×224×224 images over the wire when N−1 of
them will be thrown away, and it puts the crop — the classifier's only input —
under the browser's control. A crop that arrives from outside is a crop nobody
can vouch for.

**Keep one request and analyse every face.** Honest, and hopeless: N faces is
N × a minute or more on a 4 GB card with a lock serialising the GPU path.

## Consequences

**The API is stateful, and the state is in memory.** `_pending` is a plain
dict in one process, matching `_gpu_lock` beside it. A restart loses every
outstanding token. This is a single-user local demo, not a hosted service, and
the cost of being wrong about that is one failed upload.

**Abandoned picks leak.** The token is spent by `/analyze` and by nothing
else, so backing out of the picker — "choose a different photo" — leaves the
temp file and its dict entry behind for the life of the process. Accepted
deliberately, as the same shape of gap as the un-swept heatmap directory. A
TTL sweep on `/detect` is the cheap fix if it ever matters.

**The default face changed from leftmost to largest.** With a picker in front
of it, "which face when nobody chooses" became a question the software answers
in two places, and it was answering differently in each: `detect_face()` took
the leftmost while the picker highlighted the largest. Both now use
`recommended_face_index()` — largest by bbox area, ties broken by `det_score`.

It is a heuristic about framing, not about who the photo is of. A photo
usually frames its subject biggest, but a bystander standing closer to the
camera still wins, and nothing here has been measured — there is no ground
truth in this project for "the face the submitter meant." It beats leftmost,
which was an artefact of sort order, and that is the whole of the claim. The
left-to-right sort survives as reading order for the picker's numbered boxes,
which is a different job.

Two knock-on effects. The rule is written twice, once per side of the wire
(`face_pipeline.recommended_face_index`, `lib/faces.js`), rather than shipped
as a field on `/detect`: the endpoint reports what it found, and what to do
about it is each side's business. And re-running `scripts/export_showcase.py`
could now export a different crop for a multi-face showcase image than the one
currently in `showcase/`. Nothing in `results/` moves — the evaluation scripts
never call face detection at all, because the dataset is already cropped
faces, so no reported metric depends on this.

**An Analysis records which face it describes.** `face_index` is on the result
alongside `faces_found`. A verdict for a four-face photo that cannot say which
of the four it is about is an incomplete record of its own run — and the
interface was getting it wrong in exactly that way, telling every multi-face
submitter that "VeraLens analysed the first one" no matter which they picked.

The result deliberately does *not* record whether a human chose the face. A
face picked by hand and the same face taken by default produce identical
bytes, so the distinction would have to be tracked in the browser and carried
alongside the Analysis, and the screens would then be asserting something the
stored Analysis cannot vouch for. Which face it describes, it can vouch for;
that is what the interface says.
