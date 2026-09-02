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
 * POST the photo and wait. This blocks for 60-90 seconds: the backend runs
 * four models in sequence on one GPU and answers once, at the end.
 *
 * The failure the interface sees most often — no face in the photo — comes
 * back as HTTP 200 with an "error" key, not as a 4xx, so the status check
 * alone is not enough.
 */
export async function analyze(file, { signal } = {}) {
  const form = new FormData()
  form.append('file', file)

  let response
  try {
    response = await fetch(asset('/analyze'), { method: 'POST', body: form, signal })
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
    // 502/503/504 come from whatever sits in front of the API — the Vite dev
    // proxy, or nginx — and mean it could not reach the backend at all. That
    // is the same situation as a refused connection, not a server that ran and
    // failed, so it gets the "did it start?" advice rather than "check the log".
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

  const result = await response.json()

  if (result.error === 'no_face_detected') {
    throw new AnalysisError('no_face', 'The face detector did not find a face.')
  }
  if (result.error) {
    throw new AnalysisError('server', String(result.error))
  }
  return result
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
