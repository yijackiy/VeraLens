# VeraLens — frontend

React 19 + Vite + Tailwind v4. Implements the nine designed screens of the
VeraLens interface against the FastAPI backend in `../backend`.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

The backend has to be running too, from the repo root:

```bash
..\venv\Scripts\python.exe -m uvicorn backend.app.api.main:app --port 8000
```

The dev server proxies `/analyze`, `/health` and `/static` to port 8000, so the
browser only ever talks to one origin and CORS never enters the picture. Set
`VITE_API_BASE` only if the API lives somewhere else.

`npm run build` emits `dist/`, which is meant to be served next to the API.

## Layout

```
src/
  api/client.js       POST /analyze, and the four failure kinds it can produce
  lib/analysis.js     fusion constants, severity bands, file limits, formatting
  hooks/              useCamera (one still, always released), useElapsed
  components/         Page chrome, sidebar, icons, the "How this works" panel
  screens/            one file per state of App.jsx's machine
  index.css           the Warmth & Wisdom design tokens, as Tailwind @theme
```

`App.jsx` is a state machine rather than a router — there is one flow, and no
verdict outlives the photo that produced it:

```
idle ─┬─ file chosen ─────────────→ analyzing ─┬→ verdict (fake / real / degraded)
      ├─ camera → review ─────────→ analyzing  ├→ problem (no face / unreachable / 5xx)
      └─ camera-blocked                        └→ idle (stopped waiting)
```

## Things worth knowing before changing it

- **`/analyze` blocks for 60–90 seconds and reports no progress.** The waiting
  screen marks stages by typical timing and says so; it never claims to know
  which stage is running. Real progress needs an SSE or polling endpoint.
- **Failures arrive as HTTP 200** with an `error` key, so `client.js` branches
  on the body, not the status.
- **Never trigger an analysis from an effect.** StrictMode double-invokes them
  in development and the backend serialises the GPU, so the second POST queues
  a second 70-second run behind the first.
- **The fusion weights (0.55 / 0.45) and the 0.50 threshold are duplicated**
  from `backend/app/fusion/fusion.py` into `lib/analysis.js`, which needs them
  to recover the reasoning layer's own Fake Probability — `/analyze` returns
  the fused number and the classifier's, but not the reasoning layer's. If the
  backend starts returning `llm_fake_probability`, delete the derivation.
- **Severity bands are a display decision made here**, not by the model:
  High ≥ 0.70, Medium ≥ 0.45, Low below that.
- Two things in the design were deliberately not built, because neither exists:
  the Methodology page (the "How this works" panel covers it instead) and the
  Sample photos card (dataset images are pre-cropped and fail face detection).
