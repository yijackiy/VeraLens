/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { analyze } from './api/client'

/**
 * The held slot, exercised through the real screens.
 *
 * These transitions are not pure — the thing most likely to break is object-URL
 * lifetime, and a photo A whose preview has been revoked still renders, just
 * blank. Only a test that drives the component and watches revokeObjectURL
 * catches that, which is why this file exists rather than more unit tests of
 * lib/comparison.js.
 */

vi.mock('./api/client', async () => {
  const actual = await vi.importActual('./api/client')
  return { ...actual, analyze: vi.fn(), ping: vi.fn().mockResolvedValue(true) }
})

const CREATED = []
const REVOKED = []

function analysisFor(probability) {
  return {
    final_verdict: probability > 0.5 ? 'fake' : 'real',
    fake_probability: probability,
    final_confidence: probability,
    classifier_score: probability,
    explanation_available: true,
    explanation: 'A sentence about the face.',
    signals: [],
    heatmap_url: '/static/heatmaps/x.png',
    faces_found: 1,
    elapsed_seconds: 40,
  }
}

function choose(name) {
  const input = document.querySelector('input[type="file"]')
  const file = new File(['x'], name, { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  CREATED.length = 0
  REVOKED.length = 0
  let counter = 0
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:photo-${++counter}`
    CREATED.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url) => REVOKED.push(url))
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function reachVerdictWith(name, probability) {
  analyze.mockResolvedValueOnce(analysisFor(probability))
  choose(name)
  await screen.findByText(/how the verdict was reached/i)
}

describe('holding an analysis for comparison', () => {
  it('keeps photo A alive while the second photo is chosen', async () => {
    render(<App />)
    await reachVerdictWith('first.jpg', 0.08)

    fireEvent.click(screen.getByRole('button', { name: /compare with another photo/i }))

    // The upload screen says which photo is parked, and A's object URL has
    // survived the trip back: the held slot owns it now, not `photo`.
    await screen.findByText(/is held as photo A/i)
    expect(REVOKED).not.toContain(CREATED[0])
  })

  it('shows both analyses on one scale once the second lands', async () => {
    render(<App />)
    await reachVerdictWith('first.jpg', 0.08)
    fireEvent.click(screen.getByRole('button', { name: /compare with another photo/i }))
    await screen.findByText(/is held as photo A/i)

    analyze.mockResolvedValueOnce(analysisFor(0.91))
    choose('second.jpg')

    await screen.findByText(/two photos, one scale/i)
    screen.getByText("first.jpg")
    screen.getByText("second.jpg")
    // Neither preview may have been freed — both are on screen.
    expect(REVOKED).toHaveLength(0)
  })

  it('survives a second photo that fails, and keeps the way back to A', async () => {
    render(<App />)
    await reachVerdictWith('first.jpg', 0.08)
    fireEvent.click(screen.getByRole('button', { name: /compare with another photo/i }))
    await screen.findByText(/is held as photo A/i)

    analyze.mockRejectedValueOnce(
      Object.assign(new Error('The face detector did not find a face.'), { kind: 'no_face' }),
    )
    choose('second.jpg')

    await screen.findByText(/still held as/i)
    expect(REVOKED).not.toContain(CREATED[0])

    fireEvent.click(screen.getByRole('button', { name: /back to photo A alone/i }))

    // Back on A's verdict, with the failed second photo's preview released.
    await screen.findByText(/how the verdict was reached/i)
    expect(REVOKED).toContain(CREATED[1])
    expect(REVOKED).not.toContain(CREATED[0])
  })

  it('releases both previews when the comparison is abandoned', async () => {
    render(<App />)
    await reachVerdictWith('first.jpg', 0.08)
    fireEvent.click(screen.getByRole('button', { name: /compare with another photo/i }))
    await screen.findByText(/is held as photo A/i)

    analyze.mockResolvedValueOnce(analysisFor(0.91))
    choose('second.jpg')
    await screen.findByText(/two photos, one scale/i)

    fireEvent.click(screen.getByRole('button', { name: /start over with a new photo/i }))

    await waitFor(() => {
      expect(REVOKED).toContain(CREATED[0])
      expect(REVOKED).toContain(CREATED[1])
    })
  })

  it('does not offer a comparison from inside one', async () => {
    render(<App />)
    await reachVerdictWith('first.jpg', 0.08)
    fireEvent.click(screen.getByRole('button', { name: /compare with another photo/i }))
    await screen.findByText(/is held as photo A/i)

    analyze.mockResolvedValueOnce(analysisFor(0.91))
    choose('second.jpg')
    await screen.findByText(/two photos, one scale/i)

    expect(screen.queryByRole('button', { name: /compare with another photo/i })).toBeNull()
  })
})

/** A promise this test resolves by hand, so photo B can be left mid-flight. */
function deferred() {
  let settle
  const promise = new Promise((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * A filled slot swaps its dropzone — and its file input — for a preview, so
 * "the empty slot's input" is always the first one still in the document.
 */
function chooseIntoNextSlot(name) {
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('no empty slot to choose into')
  const file = new File(['x'], name, { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
}

/**
 * Two layers of object URLs exist in this flow. ComparePickScreen makes its own
 * for the two slot previews and revokes them when it unmounts — correctly — so
 * the first two entries in CREATED are always those, and App's own photos for A
 * and B follow.
 */
const appPhotoA = () => CREATED[2]
const appPhotoB = () => CREATED[3]

describe('choosing both photos up front', () => {
  async function pickBoth() {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /compare two/i }))
    await screen.findByRole('button', { name: /choose both photos first/i })

    chooseIntoNextSlot('first.jpg')
    chooseIntoNextSlot('second.jpg')

    const go = await screen.findByRole('button', { name: /analyse both photos/i })
    fireEvent.click(go)
  }

  it('runs photo A first and says photo B is queued behind it', async () => {
    const b = deferred()
    analyze.mockResolvedValueOnce(analysisFor(0.08)).mockReturnValueOnce(b.promise)

    await pickBoth()

    // Photo A's verdict is readable while B is still running, rather than both
    // photos sharing one long blank wait.
    await screen.findByText(/how the verdict was reached/i)
    await screen.findByText(/is being\s*analysed now/i)
    expect(REVOKED).not.toContain(appPhotoA())
    expect(REVOKED).not.toContain(appPhotoB())

    b.settle(analysisFor(0.91))
    await screen.findByText(/two photos, one scale/i)
  })

  it('does not offer "compare with another" while B is in flight', async () => {
    const b = deferred()
    analyze.mockResolvedValueOnce(analysisFor(0.08)).mockReturnValueOnce(b.promise)

    await pickBoth()
    await screen.findByText(/is being\s*analysed now/i)

    expect(screen.queryByRole('button', { name: /compare with another photo/i })).toBeNull()
  })

  it('keeps photo A when the second run is stopped part-way', async () => {
    const b = deferred()
    analyze.mockResolvedValueOnce(analysisFor(0.08)).mockReturnValueOnce(b.promise)

    await pickBoth()
    await screen.findByText(/is being\s*analysed now/i)

    fireEvent.click(screen.getByRole('button', { name: /stop and keep A/i }))

    // Still photo A's verdict, and now offering a comparison again because
    // there is no longer one in flight.
    await screen.findByRole('button', { name: /compare with another photo/i })
    expect(screen.queryByText(/is being\s*analysed now/i)).toBeNull()
    expect(REVOKED).toContain(appPhotoB())
    expect(REVOKED).not.toContain(appPhotoA())
  })
})
