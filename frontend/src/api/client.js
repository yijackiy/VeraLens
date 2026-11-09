// Same-origin by default: the dev server proxies /detect, /analyze, /result, /progress,
// /health and /static to the backend, and in production FastAPI serves the built bundle itself.
// Set VITE_API_BASE only when the API genuinely lives somewhere else.
const API_BASE = import.meta.env.VITE_API_BASE ?? ''

/**
 * kind is what the interface branches on:
 *   'no_face'    — a face was never found, so nothing was judged
 *   'unreachable' — the backend did not answer at all
 *   'server'     — it answered with a 5xx
 *   'aborted'    — the caller walked away (see the note in analyze())
 */
export class AnalysisError extends Error {
  constructor(kind, message, { cause } = {}) {
    super(message, { cause })
    this.name = 'AnalysisError'
    this.kind = kind
  }
}

export function asset(path) {
  return `${API_BASE}${path}`
}

/**
 * Wraps a fetch() the way both /detect and /analyze need: AbortError becomes
 * 'aborted', a network failure or a 502/503/504 (the dev proxy or nginx
 * unable to reach the backend at all, not a server that ran and failed)
 * becomes 'unreachable', and anything else non-2xx becomes 'server' with
 * whatever detail the response carries.
 */
async function post(path, { signal, ...init }) {
  let response
  try {
    response = await fetch(asset(path), { method: 'POST', signal, ...init })
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      throw new AnalysisError('aborted', 'Analysis was cancelled.', { cause })
    }
    throw new AnalysisError(
      'unreachable',
      'VeraLens could not reach the analysis server.',
      { cause },
    )
  }

  if (!response.ok) {
    if ([502, 503, 504].includes(response.status)) {
      throw new AnalysisError(
        'unreachable',
        'VeraLens could not reach the analysis server.',
      )
    }
    const detail = await response.json().then((body) => body?.detail).catch(() => null)
    throw new AnalysisError(
      'server',
      detail ? String(detail) : `The analysis server returned ${response.status}.`,
    )
  }

  return response.json()
}

/**
 * Step 1 of 2. POST the photo and get back, within about a second, either an
 * empty face list (no_face) or a token plus one entry per detected face,
 * left to right — {index, bbox, det_score, width, height}. One face resolves
 * silently into analyzeFace(); more than one is what the picker is for.
 */
export async function detectFaces(file, { signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  const result = await post('/detect', { signal, body: form })

  if (result.faces.length === 0) {
    throw new AnalysisError('no_face', 'The face detector did not find a face.')
  }
  return result
}

// How often analyzeFace() asks whether the Analysis has finished, and how many
// polls in a row may fail (a dropped connection, the tunnel reconnecting)
// before the wait is given up as 'unreachable'. One blip must not throw away a
// three-minute Analysis that is still running on the server.
export const RESULT_POLL_MS = 2000
const MAX_POLL_FAILURES = 5

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new AnalysisError('aborted', 'Analysis was cancelled.'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Step 2 of 2. Takes the token detectFaces() returned and which face was
 * chosen, and resolves with the result of the slow half of the pipeline —
 * classifier, Grad-CAM and Qwen3-VL in sequence on one GPU, a minute at the
 * median and ~3 at p90.
 *
 * POST /analyze answers at once (202) and the Analysis runs on the server
 * while this polls GET /result/{token} (ADR 0016). A single request held open
 * that long is cut off at 100 s by Cloudflare's proxy. To callers nothing
 * changed: one promise, the result or an AnalysisError.
 */
export async function analyzeFace(token, faceIndex, { signal } = {}) {
  const form = new FormData()
  form.append('token', token)
  form.append('face_index', String(faceIndex))
  await post('/analyze', { signal, body: form })

  let failures = 0
  for (;;) {
    await pause(RESULT_POLL_MS, signal)
    let response
    try {
      response = await fetch(asset(`/result/${encodeURIComponent(token)}`), { signal })
    } catch (cause) {
      if (cause?.name === 'AbortError') {
        throw new AnalysisError('aborted', 'Analysis was cancelled.', { cause })
      }
      response = null
    }

    if (response?.status === 202) {
      failures = 0
      continue
    }
    if (response?.ok) return response.json()

    // No answer, or the proxy could not reach the backend: try again a few
    // times before deciding the server is gone.
    if (response === null || [502, 503, 504, 530].includes(response.status)) {
      failures += 1
      if (failures >= MAX_POLL_FAILURES) {
        throw new AnalysisError('unreachable', 'VeraLens could not reach the analysis server.')
      }
      continue
    }

    const detail = await response.json().then((body) => body?.detail).catch(() => null)
    throw new AnalysisError(
      'server',
      detail ? String(detail) : `The analysis server returned ${response.status}.`,
    )
  }
}

/**
 * Where the Analysis for this token has got to — { stage, ... } while it runs,
 * { stage: null } when the backend knows nothing of it. Asked while
 * analyzeFace() is still waiting, which works because the backend answers it
 * from a different thread than the one holding the graphics card.
 *
 * Best effort by design: any failure resolves to null. The POST is the source
 * of truth for whether the analysis worked, and a missed poll must never turn
 * a healthy wait into an error screen.
 */
export async function getProgress(token, { signal } = {}) {
  try {
    const response = await fetch(asset(`/progress/${encodeURIComponent(token)}`), { signal })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** Cheap liveness probe. Answers while an analysis is running. */
export async function ping() {
  try {
    const response = await fetch(asset('/health'))
    return response.ok
  } catch {
    return false
  }
}
