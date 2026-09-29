/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { analyzeFace, detectFaces } from './api/client'

/**
 * The multi-face picker, exercised through the real screens.
 *
 * The one thing worth being wrong about here is silence: a photo with two
 * faces must stop and ask, not quietly analyse whichever InsightFace
 * returned first. A single face must do the opposite — the picker would be
 * a pointless extra click for the common case, so it must never appear then.
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
    faces_found: 2,
    elapsed_seconds: 40,
  }
}

function twoFaceDetection() {
  return {
    token: 'tok',
    faces: [
      // Large enough on both axes to clear the picker's 150px small-face
      // warning threshold — only the second face should trigger it.
      { index: 0, bbox: [10, 10, 310, 390], det_score: 0.9, width: 300, height: 380 },
      { index: 1, bbox: [400, 40, 440, 80], det_score: 0.7, width: 40, height: 40 },
    ],
  }
}

function choose(name = 'group.jpg') {
  const input = document.querySelector('input[type="file"]')
  const file = new File(['x'], name, { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
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

describe('the multi-face picker', () => {
  it('stops at the picker when more than one face is found', async () => {
    detectFaces.mockResolvedValueOnce(twoFaceDetection())
    render(<App />)

    choose()

    await screen.findByText(/2 faces here\. Which one\?/i)
    // Nothing has been classified yet — /analyze is not called just for
    // showing the picker.
    expect(analyzeFace).not.toHaveBeenCalled()
  })

  it('flags the small face as an upscale risk, and not the large one', async () => {
    detectFaces.mockResolvedValueOnce(twoFaceDetection())
    render(<App />)
    choose()
    await screen.findByText(/2 faces here\. Which one\?/i)

    const warnings = screen.getAllByText(/upscaled pixels/i)
    expect(warnings).toHaveLength(1)
  })

  it('analyses the chosen face and reaches its verdict', async () => {
    detectFaces.mockResolvedValueOnce(twoFaceDetection())
    analyzeFace.mockResolvedValueOnce(analysisFor(0.12))
    render(<App />)
    choose()
    await screen.findByText(/2 faces here\. Which one\?/i)

    const analyseButtons = screen.getAllByRole('button', { name: /^analyse$/i })
    fireEvent.click(analyseButtons[1]) // the second row: face index 1

    await screen.findByText(/how the verdict was reached/i)
    expect(analyzeFace).toHaveBeenCalledWith('tok', 1, expect.anything())
  })

  it('never shows the picker for a single detected face', async () => {
    detectFaces.mockResolvedValueOnce({
      token: 'tok',
      faces: [{ index: 0, bbox: [10, 10, 110, 210], det_score: 0.9, width: 100, height: 200 }],
    })
    analyzeFace.mockResolvedValueOnce(analysisFor(0.12))
    render(<App />)
    choose()

    await screen.findByText(/how the verdict was reached/i)
    expect(screen.queryByText(/which one\?/i)).toBeNull()
    expect(analyzeFace).toHaveBeenCalledWith('tok', 0, expect.anything())
  })

  it('lets "choose a different photo" abandon the picker and go back to idle', async () => {
    detectFaces.mockResolvedValueOnce(twoFaceDetection())
    render(<App />)
    choose()
    await screen.findByText(/2 faces here\. Which one\?/i)

    fireEvent.click(screen.getByRole('button', { name: /choose a different photo/i }))

    await screen.findByText(/check a face photo/i)
    expect(analyzeFace).not.toHaveBeenCalled()
  })
})
