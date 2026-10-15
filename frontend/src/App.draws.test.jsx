/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { analyzeFace, detectFaces } from './api/client'

/**
 * Draws, exercised through the real screens (CONTEXT.md, "Draw").
 *
 * The things worth being wrong about: a Draw must ask about the same face
 * without stopping at the picker; it must never replace the Verdict on the
 * page; a result whose classifier reading differs must not be counted as a
 * Draw; a failed request must not use up one of the five; and when nothing
 * moved, the page must not let "consistent" read as "confirmed".
 */

vi.mock('./api/client', async () => {
  const actual = await vi.importActual('./api/client')
  return {
    ...actual,
    detectFaces: vi.fn(),
    analyzeFace: vi.fn(),
    ping: vi.fn().mockResolvedValue(true),
  }
})

const CHECKLIST = [
  'hairline boundary consistency',
  'eye highlight symmetry',
  'skin texture consistency',
  'lighting direction consistency',
  'edge blending around the face contour',
]

function analysis({
  severities = [0.8, 0.8, 0.8, 0.8, 0.8],
  verdict = 'fake',
  classifier = 0.93,
  explained = true,
  explanation = 'Draw text.',
  faces_found = 1,
  face_index = 0,
} = {}) {
  return {
    final_verdict: verdict,
    fake_probability: verdict === 'fake' ? 0.9 : 0.3,
    final_confidence: 0.9,
    classifier_score: classifier,
    explanation_available: explained,
    explanation: explained ? explanation : 'Parsing failed — raw output logged for debugging.',
    signals: explained
      ? severities.map((severity, i) => ({ name: CHECKLIST[i], severity, note: 'n' }))
      : [],
    heatmap_url: '/static/heatmaps/x.png',
    faces_found,
    face_index,
    elapsed_seconds: 60,
  }
}

const ONE_FACE = {
  token: 'tok',
  faces: [{ index: 0, bbox: [10, 10, 210, 210], det_score: 0.9, width: 200, height: 200 }],
}

function twoFaces() {
  return {
    token: 'tok',
    faces: [
      { index: 0, bbox: [0, 0, 40, 40], det_score: 0.9, width: 40, height: 40 },
      { index: 1, bbox: [100, 0, 400, 380], det_score: 0.9, width: 300, height: 380 },
    ],
  }
}

function choose(name = 'portrait.jpg') {
  const input = document.querySelector('input[type="file"]')
  const file = new File(['x'], name, { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
}

async function reachVerdict(first = analysis()) {
  detectFaces.mockResolvedValueOnce(ONE_FACE)
  analyzeFace.mockResolvedValueOnce(first)
  render(<App />)
  choose()
  await screen.findByText(/how the verdict was reached/i)
}

/** The register is cached at module level, so every test says which it wants. */
function useRegister(name) {
  fireEvent.click(screen.getByRole('radio', { name }))
}

const drawButton = () => screen.getByRole('button', { name: /draw again/i })

async function drawOnce(next) {
  detectFaces.mockResolvedValueOnce(ONE_FACE)
  analyzeFace.mockResolvedValueOnce(next)
  fireEvent.click(drawButton())
  await screen.findByText(/what each draw wrote/i)
}

beforeEach(() => {
  let counter = 0
  URL.createObjectURL = vi.fn(() => `blob:photo-${++counter}`)
  URL.revokeObjectURL = vi.fn()
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

describe('Draws', () => {
  it('asks about the same face again, skipping the picker', async () => {
    // Two faces: the first Analysis went through the picker and chose face 1.
    detectFaces.mockResolvedValueOnce(twoFaces())
    analyzeFace.mockResolvedValueOnce(analysis({ faces_found: 2, face_index: 1 }))
    render(<App />)
    choose()
    await screen.findByText(/2 faces here/i)
    fireEvent.click(screen.getAllByRole('button', { name: /^analyse$/i })[1])
    await screen.findByText(/how the verdict was reached/i)
    useRegister(/plain/i)

    detectFaces.mockResolvedValueOnce(twoFaces())
    analyzeFace.mockResolvedValueOnce(analysis({ faces_found: 2, face_index: 1 }))
    fireEvent.click(drawButton())
    await screen.findByText(/2 of 5 draws/i)

    // Same face, and no stop at the picker on the way.
    expect(analyzeFace).toHaveBeenLastCalledWith('tok', 1, expect.anything())
    expect(screen.queryByText(/which one\?/i)).toBeNull()
  })

  it('never replaces the Verdict on the page, even when a Draw disagrees', async () => {
    await reachVerdict(analysis({ verdict: 'fake', explanation: 'Draw one text.' }))
    useRegister(/plain/i)

    await drawOnce(analysis({ verdict: 'real', explanation: 'Draw two text.' }))

    expect(screen.getByText(/Draw 2 would have reached a different Verdict — Real, not Fake/i)).toBeTruthy()
    // The page still leads with Draw 1's explanation; Draw 2's is below it.
    expect(screen.getByText('Draw one text.')).toBeTruthy()
    expect(screen.getByText('Draw two text.')).toBeTruthy()
  })

  it("shows each later Draw's own Fake Probability and time, as Draw 1 does", async () => {
    await reachVerdict(analysis({ verdict: 'fake' }))
    useRegister(/plain/i)

    await drawOnce({ ...analysis({ verdict: 'real', explanation: 'Draw two text.' }), elapsed_seconds: 75 })

    const drawTwo = screen.getByText('Draw two text.').parentElement
    expect(within(drawTwo).getByText('Fake Probability')).toBeTruthy()
    expect(within(drawTwo).getByText('30.0%')).toBeTruthy()
    expect(within(drawTwo).getByText('1m 15s')).toBeTruthy()
    expect(within(drawTwo).getByText(/50% threshold/i)).toBeTruthy()
  })

  it("says a Draw without an explanation shows the classifier's number alone", async () => {
    await reachVerdict()
    useRegister(/plain/i)

    await drawOnce(analysis({ explained: false }))

    expect(screen.getByText(/this is the classifier's number alone/i)).toBeTruthy()
  })

  it('says which signals moved, in plain language', async () => {
    await reachVerdict(analysis({ severities: [0.9, 0.8, 0.8, 0.8, 0.8] }))
    useRegister(/plain/i)

    await drawOnce(analysis({ severities: [0.5, 0.8, 0.7, 0.8, 0.8] }))

    expect(screen.getByText(/changed how serious it rated one signal/i)).toBeTruthy()
    expect(screen.getByText(/rated much less serious than in Draw 1/i)).toBeTruthy()
    // Plain gets the finding, not the table.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('calls stable ratings consistency, and says why that is not confirmation', async () => {
    await reachVerdict()
    useRegister(/plain/i)

    await drawOnce(analysis({ severities: [0.7, 0.8, 0.8, 0.9, 0.8] }))

    expect(screen.getByText(/consistency, not confirmation/i)).toBeTruthy()
    expect(screen.getByText(/it was told what the classifier had found/i)).toBeTruthy()
  })

  it('shows the raw ratings in the technical register', async () => {
    await reachVerdict(analysis({ severities: [0.9, 0.8, 0.8, 0.8, 0.8] }))
    useRegister(/technical/i)

    await drawOnce(analysis({ severities: [0.5, 0.8, 0.8, 0.8, 0.8] }))

    const table = screen.getByRole('table')
    expect(table.textContent).toMatch(/0\.90/)
    expect(table.textContent).toMatch(/0\.50/)
    expect(table.textContent).toMatch(/0\.40\s*\(moved\)/)
    // The finding is in Technical too — Plain stays a strict reduction.
    expect(screen.getByText(/rated much less serious than in Draw 1/i)).toBeTruthy()
    useRegister(/plain/i)
  })

  it('does not count a result whose classifier reading differs', async () => {
    await reachVerdict(analysis({ classifier: 0.93 }))
    useRegister(/plain/i)

    await drawOnce(analysis({ classifier: 0.41 }))

    expect(screen.getByText(/Not a Draw of this Analysis/i)).toBeTruthy()
    expect(screen.getByText(/1 of 5 draws/i)).toBeTruthy()
  })

  it('does not use up a Draw when the request fails', async () => {
    await reachVerdict()
    useRegister(/plain/i)

    detectFaces.mockRejectedValueOnce(Object.assign(new Error('Server unreachable.'), { kind: 'unreachable' }))
    fireEvent.click(drawButton())
    await screen.findByText(/didn't produce a Draw/i)

    expect(screen.getByText(/1 of 5 draws/i)).toBeTruthy()
  })

  it('counts a Draw that produced no explanation, and reports it', async () => {
    await reachVerdict()
    useRegister(/plain/i)

    await drawOnce(analysis({ explained: false }))

    expect(screen.getByText(/2 of 5 draws/i)).toBeTruthy()
    expect(screen.getByText(/1 of 2 Draws produced no explanation/i)).toBeTruthy()
    expect(screen.getByText(/nothing to compare yet/i)).toBeTruthy()
  })

  it('offers one Draw at a time', async () => {
    await reachVerdict()
    useRegister(/plain/i)

    detectFaces.mockResolvedValueOnce(ONE_FACE)
    let finish
    analyzeFace.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(drawButton())

    await screen.findByText(/Draw 2 running/i)
    expect(drawButton().disabled).toBe(true)

    await act(async () => finish(analysis()))
    await screen.findByText(/2 of 5 draws/i)
    expect(drawButton().disabled).toBe(false)
  })

  it('stops offering Draws at five', async () => {
    await reachVerdict()
    useRegister(/plain/i)

    for (let n = 2; n <= 5; n += 1) {
      detectFaces.mockResolvedValueOnce(ONE_FACE)
      analyzeFace.mockResolvedValueOnce(analysis())
      fireEvent.click(drawButton())
      await screen.findByText(n === 5 ? /all 5 draws used/i : new RegExp(`${n} of 5 draws`, 'i'))
    }

    expect(drawButton().disabled).toBe(true)
  })

  it('starts the next Analysis with no Draws, even if an old one lands late', async () => {
    await reachVerdict()
    useRegister(/plain/i)

    // A Draw of the first Analysis is still running when the person starts over.
    detectFaces.mockResolvedValueOnce(ONE_FACE)
    let lateDraw
    analyzeFace.mockReturnValueOnce(new Promise((resolve) => (lateDraw = resolve)))
    fireEvent.click(drawButton())
    await screen.findByText(/Draw 2 running/i)

    fireEvent.click(screen.getAllByRole('button', { name: /back to uploads/i })[0])
    await screen.findByText(/check a face photo/i)
    detectFaces.mockResolvedValueOnce(ONE_FACE)
    analyzeFace.mockResolvedValueOnce(analysis({ classifier: 0.12, verdict: 'real' }))
    choose('another.jpg')
    await screen.findByText(/how the verdict was reached/i)

    // The old Draw lands only now, with the new Analysis already on screen.
    // It must not turn up as a Draw of an Analysis it never belonged to.
    await act(async () => lateDraw(analysis({ classifier: 0.12, verdict: 'real' })))

    expect(screen.getByText(/1 of 5 draws/i)).toBeTruthy()
    expect(screen.queryByText(/what each draw wrote/i)).toBeNull()
  })

  it('stops a Draw in flight when the Analysis is held for a Comparison', async () => {
    // Holding carries the Analysis as first shown; its Draws stay behind.
    await reachVerdict()
    useRegister(/plain/i)

    detectFaces.mockResolvedValueOnce(ONE_FACE)
    analyzeFace.mockReturnValueOnce(new Promise(() => {}))
    fireEvent.click(drawButton())
    await screen.findByText(/Draw 2 running/i)
    const { signal } = analyzeFace.mock.calls.at(-1)[2]
    expect(signal.aborted).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /compare with another photo/i }))

    expect(signal.aborted).toBe(true)
  })
})
