# /analyze answers at once and the result is polled

Until this change `POST /analyze` held its request open for the whole Analysis
and answered once, with the result. That was simple and it worked on
`localhost`. It stops working as soon as the app is reached through Cloudflare,
which is how it is deployed (`DEPLOY.md`).

## The constraint

Cloudflare's proxy waits **100 seconds** for an origin to start answering and
then gives the visitor **error 524**. A Cloudflare Tunnel goes through the same
proxy, and on the Free plan the limit cannot be raised.

The measured Analysis duration is long-tailed: 40 s at the floor, 60 s median,
169 s at p90, and 36% of runs past 90 s (n = 600, the `seconds` field in
`results/ablation_records*.jsonl`). So a blocking `/analyze` behind Cloudflare
would fail on roughly a third of photos even when the server is idle. When the
server is busy it would fail more often, because an Analysis queued behind
another spends its first minute waiting for `_gpu_lock`.

## The decision

- `POST /analyze` still checks the token and face index synchronously, and
  answers 404 or 400 as before. It then starts the pipeline on a background
  thread and answers **202** immediately.
- `GET /result/{token}` answers 202 while the Analysis runs, 200 with the
  result, 500 if the pipeline raised, and 404 for a token that never started
  or whose result has expired. A finished result can be read again for 10
  minutes, so a poll whose response is lost does not lose the Analysis.
- `analyzeFace()` in `frontend/src/api/client.js` polls `/result` every 2 s.
  It gives up as `unreachable` only after five polls in a row have failed.
  Callers still get one promise resolving to the same result object, so
  `App.jsx`, `useBatch.js` and their tests did not change.
- `/progress/{token}` is unchanged. `progress.track()` now runs on the
  Analysis thread, which is where its ContextVar has to be set.

## Considered and not chosen

- **Streaming or keep-alive bytes on the open request.** Cloudflare's limit is
  on the time to the *first* byte, so trickling whitespace ahead of a JSON body
  would get past it. But the response would then be a stream that only looks
  like JSON, which every client and test would have to parse specially. It
  would also still drop if the tunnel reconnected mid-Analysis.
- **Server-Sent Events or WebSockets.** Both get through the tunnel, but they
  add a second protocol to answer a question that a 2-second poll answers well
  enough for a one-GPU demo.
- **Paying for a higher timeout or hosting elsewhere.** The higher timeout is
  Enterprise-only, and hosting elsewhere would break the 4 GB local-inference
  constraint.

## What came with it

These matter only because the app is now reachable from the internet:

- At most `VERALENS_MAX_ACTIVE` Analyses (default 4) may be running or queued.
  Past that, `/analyze` answers **429** and the upload stays usable for a
  retry. With one Analysis at a time and a minute each at the median, a fifth
  photo would wait longer than anyone stays on the page.
- Uploads over `VERALENS_MAX_UPLOAD_MB` (default 20) are refused with **413**.
- Uploads never analysed are deleted after 15 minutes. Results never collected
  are dropped after 10 minutes. Before this, an abandoned upload stayed in the
  temp directory until restart, which was an accepted gap only while the app
  was local.
- `VERALENS_PUBLIC=1` switches off `/docs`, `/redoc` and `/openapi.json`.
- FastAPI serves `frontend/dist` itself when the directory exists, so the
  deployed site is one process on one origin, with no nginx and no CORS.

## Consequences

- State is still in memory, so the server **must run as a single uvicorn
  worker**. A restart loses running Analyses and uncollected results, the same
  as before.
- Each Analysis runs on its own thread. `_gpu_lock` remains the only thing
  serialising GPU work, and `MAX_ACTIVE_ANALYSES` bounds how many threads can
  be waiting on it.
- The browser now makes one extra request every 2 s during a wait. That is
  negligible next to a one-minute Analysis.
