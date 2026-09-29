/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { detectFaces } from './api/client'

/**
 * Routing into and out of the "Straighten first" card only. The transform
 * itself (rotateAndCrop, in lib/imageTransform.js) draws through
 * createImageBitmap and a canvas, neither of which jsdom implements —
 * rotatedBounds() carries the real coverage for that math
 * (lib/imageTransform.test.js). What belongs here is what jsdom *can* check:
 * that choosing a file for this card lands on CropScreen instead of running
 * analysis straight away, and that both ways out of it work.
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

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo-1')
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

function chooseForCrop(name = 'sideways.jpg') {
  const input = screen.getByRole('button', { name: /straighten first/i })
    .parentElement.querySelector('input[type="file"]')
  const file = new File(['x'], name, { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('straightening a photo before it is sent', () => {
  it('opens CropScreen instead of analysing straight away', async () => {
    render(<App />)

    chooseForCrop()

    await screen.findByText(/straighten it first/i)
    expect(detectFaces).not.toHaveBeenCalled()
  })

  it('lets "choose a different photo" leave without sending anything', async () => {
    render(<App />)
    chooseForCrop()
    await screen.findByText(/straighten it first/i)

    fireEvent.click(screen.getByRole('button', { name: /choose a different photo/i }))

    await screen.findByText(/check a face photo/i)
    expect(detectFaces).not.toHaveBeenCalled()
  })
})
