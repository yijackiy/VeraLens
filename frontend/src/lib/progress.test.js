import { describe, expect, it } from 'vitest'
import { describeProgress, STEP_COUNT } from './progress'

/**
 * What the waiting screen is told, turned into what it shows.
 *
 * The backend reports a stage and, while writing, a token count. It never
 * reports a fraction and this module must not invent one: STEP_COUNT steps,
 * some of them done, one of them running. The step that takes nearly all of
 * the wait has no length, only a counter.
 */
describe('describeProgress', () => {
  it('knows nothing when it has been told nothing', () => {
    expect(describeProgress(null).known).toBe(false)
    expect(describeProgress(undefined).known).toBe(false)
    expect(describeProgress({ stage: null }).known).toBe(false)
  })

  it('ignores a stage it has never heard of rather than guessing', () => {
    // A backend newer than this page. Better indeterminate than wrong.
    expect(describeProgress({ stage: 'transmogrifying' }).known).toBe(false)
  })

  it('counts face detection as already done — /detect finished before this screen', () => {
    const queued = describeProgress({ stage: 'queued' })
    expect(queued.completed).toBe(1)
    expect(queued.active).toBeNull()
  })

  it('shows a queued analysis as waiting, not as running a step', () => {
    const queued = describeProgress({ stage: 'queued' })
    expect(queued.known).toBe(true)
    expect(queued.waiting).toBe(true)
  })

  it('walks the steps in order', () => {
    const at = (stage) => describeProgress({ stage })
    expect([at('classifying').active, at('classifying').completed]).toEqual([1, 1])
    expect([at('saliency').active, at('saliency').completed]).toEqual([2, 2])
    expect([at('loading').active, at('loading').completed]).toEqual([3, 3])
    expect([at('writing').active, at('writing').completed]).toEqual([3, 3])
  })

  it('never reaches "all done" — only the finished response does that', () => {
    for (const stage of ['queued', 'classifying', 'saliency', 'loading', 'writing']) {
      expect(describeProgress({ stage }).completed).toBeLessThan(STEP_COUNT)
    }
  })

  it('marks loading apart from writing, because the first analysis after start-up is slower', () => {
    expect(describeProgress({ stage: 'loading' }).loading).toBe(true)
    expect(describeProgress({ stage: 'writing' }).loading).toBe(false)
  })

  it('carries the token count and the attempt while writing', () => {
    const writing = describeProgress({ stage: 'writing', attempt: 2, max_attempts: 3, tokens: 41 })
    expect(writing.tokens).toBe(41)
    expect(writing.attempt).toBe(2)
    expect(writing.maxAttempts).toBe(3)
  })

  it('calls an attempt after the first a retry, and the first not one', () => {
    expect(describeProgress({ stage: 'writing', attempt: 1, max_attempts: 3 }).retrying).toBe(false)
    expect(describeProgress({ stage: 'writing', attempt: 2, max_attempts: 3 }).retrying).toBe(true)
  })

  it('has no fraction in it anywhere', () => {
    const out = describeProgress({ stage: 'writing', attempt: 1, max_attempts: 3, tokens: 90 })
    for (const key of Object.keys(out)) {
      expect(key).not.toMatch(/percent|fraction|ratio|eta|remaining/i)
    }
  })

  it('carries the server clock when it has one', () => {
    expect(describeProgress({ stage: 'saliency', elapsed_seconds: 3.4 }).serverSeconds).toBe(3.4)
  })
})
