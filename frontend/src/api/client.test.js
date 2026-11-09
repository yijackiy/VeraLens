import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalysisError, analyzeFace, RESULT_POLL_MS } from './client'

/**
 * analyzeFace() starts an Analysis and polls GET /result/{token} until it has
 * one (ADR 0016). Callers still see one promise, so what these tests pin down
 * is everything the polling must hide from them: a long wait, a dropped poll,
 * and a cancel in the middle of a pause.
 */

function reply(status, body = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

/** fetch() answering from a queue: /analyze first, then one entry per poll. */
function scriptFetch(...polls) {
  const fetchMock = vi.fn((url) => {
    if (String(url).endsWith('/analyze')) return reply(202, { token: 't', status: 'running' })
    const next = polls.shift()
    if (next === undefined) throw new Error(`unexpected poll of ${url}`)
    return typeof next === 'function' ? next() : next
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Run analyzeFace() to completion, letting each poll interval elapse. */
async function settle(promise) {
  const outcome = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  for (let i = 0; i < 50; i += 1) await vi.advanceTimersByTimeAsync(RESULT_POLL_MS)
  return outcome
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('analyzeFace', () => {
  it('keeps polling through 202s and resolves with the result', async () => {
    const fetchMock = scriptFetch(
      reply(202, { status: 'running' }),
      reply(202, { status: 'running' }),
      reply(200, { final_verdict: 'fake' }),
    )

    const { value } = await settle(analyzeFace('t', 0))

    expect(value).toEqual({ final_verdict: 'fake' })
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls).toEqual(['/analyze', '/result/t', '/result/t', '/result/t'])
  })

  it('rides out a few failed polls instead of giving up the Analysis', async () => {
    scriptFetch(
      () => Promise.reject(new TypeError('Failed to fetch')),
      reply(502),
      reply(530),
      reply(200, { final_verdict: 'real' }),
    )

    const { value } = await settle(analyzeFace('t', 0))

    expect(value).toEqual({ final_verdict: 'real' })
  })

  it('is unreachable after five failed polls in a row', async () => {
    const down = () => Promise.reject(new TypeError('Failed to fetch'))
    scriptFetch(down, down, down, down, down)

    const { error } = await settle(analyzeFace('t', 0))

    expect(error).toBeInstanceOf(AnalysisError)
    expect(error.kind).toBe('unreachable')
  })

  it('reports a pipeline failure as a server error with its detail', async () => {
    scriptFetch(reply(500, { detail: 'The analysis failed on the server.' }))

    const { error } = await settle(analyzeFace('t', 0))

    expect(error.kind).toBe('server')
    expect(error.message).toBe('The analysis failed on the server.')
  })

  it('passes on a busy server refusal from /analyze itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(429, { detail: 'VeraLens is busy with other photos.' })),
    )

    const { error } = await settle(analyzeFace('t', 0))

    expect(error.kind).toBe('server')
    expect(error.message).toBe('VeraLens is busy with other photos.')
  })

  it('stops polling when cancelled between polls', async () => {
    const fetchMock = scriptFetch(reply(202, { status: 'running' }))
    const controller = new AbortController()

    const outcome = analyzeFace('t', 0, { signal: controller.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(RESULT_POLL_MS) // first poll: still running
    controller.abort()
    const error = await outcome
    await vi.advanceTimersByTimeAsync(RESULT_POLL_MS * 5)

    expect(error.kind).toBe('aborted')
    expect(fetchMock).toHaveBeenCalledTimes(2) // /analyze + one poll, nothing after
  })
})
