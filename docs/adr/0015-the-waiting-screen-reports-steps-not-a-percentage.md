# The waiting screen reports steps, not a percentage

`POST /analyze` blocks and answers once. For a long time the waiting screen
therefore showed a clock and four cards marked from typical timing, and said so.
That was honest, and it left a person two minutes into a wait with nothing to
look at. We added a progress bar. It is made of steps and a counter, it has no
percentage in it, and that is on purpose: a bar that fills left to right looks
like the obvious thing to build here, and each way of driving one is false.

## Why not a bar that fills

A bar needs a denominator. There isn't one.

- **Driven by the clock** it would have to be scaled to some expected duration.
  The measured duration is long-tailed, not a range: 40 s at the floor, 60 s
  median, 169 s at p90, 36% of runs past 90 s (n = 600, the `seconds` field in
  `results/ablation_records*.jsonl`). Scale it to the median and it reads full
  while nearly half of all runs are still going; scale it to p90 and it crawls
  for the half that finish in a minute. Either way it states a completeness the
  system does not know.
- **Driven by tokens written** it would need the reply's length, and the reply
  ends when the model stops, not at a count. The only bound is `MAX_NEW_TOKENS`
  (512), and a reply that reached it would be cut off mid-JSON and unreadable, so
  every complete reply ends short of it. A bar scaled to 512 therefore never
  fills on a good run, and jumps to the end when the response lands. In the one
  run watched, the count passed 250 at 65 s and the reply was complete by 87 s;
  one run says nothing about the usual length, which is the point — it is not
  known in advance.

What *is* known, because the backend can say it: which of four steps an
Analysis is on, and — inside the last one, which is nearly all of the wait — how
many tokens have been written so far. The screen shows exactly that: four
segments, done or running or not yet, and a plain "Still writing" heartbeat on the
step with no length (the token count is its hover text — "tokens" is not a word
most readers have, and a count with no total invites the question "out of what?"). Nothing on it moves toward 100%, and nothing reaches "all done" before
the response lands. `lib/progress.test.js` and `AnalyzingScreen.test.jsx` pin
this, so a later tidy-up that adds a fill has to break a test to do it.

## How it works

`GET /progress/{token}` returns the stage of the Analysis for that token —
`queued`, `classifying`, `saliency`, `loading`, `writing` — plus `attempt`,
`max_attempts` and `tokens` while writing. The token is the one `/detect`
already issued. The browser asks once a second while the waiting screen is up
and stops when it goes.

- **Ambient, not passed down.** `backend/app/progress.py` holds a `ContextVar`
  set by the `/analyze` handler; `progress.report()` anywhere beneath it lands on
  the right Analysis and is a no-op everywhere else. The alternative, a callback
  parameter through `run_pipeline_from_crop()` and `run_reasoning()`, would have
  changed the signatures the evaluation scripts call and the tests fake. The
  handler runs in one threadpool thread from first line to last, so the variable
  is visible to everything it calls and invisible to a request on another thread.
- **Polling, not SSE.** The wait is long, the answer is tiny, and `/health`
  already established that a plain `def` endpoint stays responsive while a
  pipeline holds the GPU. A stream would be a second mechanism for no gain.
- **An unknown token is a 200 with `stage: null`**, not a 404: the first ask can
  arrive before `/analyze` has registered the token, and that is a healthy
  start. The screen treats it as "no report yet" and shows an indeterminate bar.
- **Counting tokens does not touch the sampling.** A `BaseStreamer` observes
  `generate()`; `SAMPLING`, the draws and the model snapshot are as ADR 0013
  left them, and a test asserts the sampling arguments are unchanged. The
  reported Explanation Quality numbers still describe this code.
- **Nothing outlives the request.** The entry is created when `/analyze` starts
  and removed when it ends, however it ends. An abandoned analysis leaves no
  state to sweep.

## What it makes visible that was not

- **The queue.** `_gpu_lock` serialises Analyses, and a second one used to wait
  silently with the clock running. It is now a stage, "Waiting for the graphics
  card", with a sentence saying the clock includes it.
- **The cold model load.** The first Analysis after the server starts loads
  Qwen3-VL before writing anything. In the one run watched for this change it
  took about 29 s of an 83 s total, and the screen now says so while it happens.
- **A retry.** When the model's reply cannot be read it is asked again, up to
  three times; the screen says "attempt 2 of 3" rather than looking stuck.

## What this does not establish

- **It does not explain the spread.** The screen can now *show* a cold load, a
  queue or a retry when one happens. Whether any of them is why a third of runs
  pass 90 s is still unknown, and the comment in `AnalyzingScreen.jsx`
  keeps saying so. One watched run is not a distribution.
- **Only the single-photo waiting screen uses it.** The backend reports for every
  Analysis, including Draws, Batch rows and a Comparison's second photo, but
  those flows do not show it yet.
- **One process.** The state is in memory in the one process that owns the
  graphics card, like `_gpu_lock` and `_pending`. A multi-worker deployment would
  need it somewhere shared; this project does not run that way.
