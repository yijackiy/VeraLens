// Same-origin by default: the dev server proxies /analyze, /health and /static
// to the backend, and a production build is meant to be served alongside it.
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

/**
 * Step 2 of 2. Takes the token detectFaces() returned and which face was
 * chosen, and waits for the slow half of the pipeline — classifier,
 * Grad-CAM and Qwen3-VL run in sequence on one GPU, so this blocks for
 * a minute at the median, ~3 at p90, and answers once, at the end.
 */
export async function analyzeFace(token, faceIndex, { signal } = {}) {
  const form = new FormData()
  form.append('token', token)
  form.append('face_index', String(faceIndex))
  return post('/analyze', { signal, body: form })
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
