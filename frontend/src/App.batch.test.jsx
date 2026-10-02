/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { AnalysisError, analyzeFace, detectFaces, ping } from './api/client'

/**
 * A Batch, exercised through the real screens (CONTEXT.md, "Batch").
 *
 * What is worth being wrong about: a photo with no face must never count as
 * Real; detection must run for every photo before the slow half starts; a
 * server that goes away must pause the queue, not fail every row left; the
 * queue must keep running while a row is read, and nothing on that row may
 * compete with it for the graphics card; and the CSV must carry its framing
 * out of the page.
 */

vi.mock('./api/client', async () => {
  const actual = await vi.importActual('./api/client')
  return { ...actual, detectFaces: vi.fn(), analyzeFace: vi.fn(), ping: vi.fn() }
})

const ONE = (token) => ({
  token,
  faces: [{ index: 0, bbox: [0, 0, 200, 200], det_score: 0.9, width: 200, height: 200 }],
})
const TWO = (token) => ({
  token,
  faces: [
    { index: 0, bbox: [0, 0, 40, 40], det_score: 0.9, width: 40, height: 40 },
    { index: 1, bbox: [100, 0, 400, 380], det_score: 0.9, width: 300, height: 380 },
  ],
})
const NO_FACE = () => new AnalysisError('no_face', 'The face detector did not find a face.')
const UNREACHABLE = () => new AnalysisError('unreachable', 'VeraLens could not reach the analysis server.')

function analysis({ verdict = 'real', p = 0.1, faces = 1, face = 0, elapsed = 50 } = {}) {
  return {
    final_verdict: verdict,
    fake_probability: p,
    final_confidence: 0.9,
    classifier_score: p,
    explanation_available: true,
    explanation: `A ${verdict} sentence.`,
    signals: [],
    heatmap_url: '/static/heatmaps/x.png',
    faces_found: faces,
    face_index: face,
    elapsed_seconds: elapsed,
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

const jpg = (name) => new File(['x'], name, { type: 'image/jpeg' })

function chooseBatch(files) {
  const input = screen.getByLabelText(/choose photos for a batch/i)
  fireEvent.change(input, { target: { files } })
}

const table = () => screen.getByRole('table')
const rowFor = (name) => within(table()).getByText(name).closest('tr')

beforeEach(() => {
  let counter = 0
  URL.createObjectURL = vi.fn(() => `blob:photo-${++counter}`)
  URL.revokeObjectURL = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  window.confirm = vi.fn(() => true)
  ping.mockResolvedValue(true)
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Batch', () => {
  it('shows the measured range and sends nothing until Start', async () => {
    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg'), new File(['x'], 'c.heic', { type: 'image/heic' })])

    await screen.findByText(/photos, one at a time/i)
    // Two photos will run (the HEIC will not): [107, 254] s, 10th–90th percentile.
    const start = screen.getByRole('button', { name: /^start$/i })
    expect(start.parentElement.textContent).toMatch(/2 photos · usually 2–4 minutes/)
    expect(within(rowFor('c.heic')).getByText('Not accepted')).toBeTruthy()
    expect(detectFaces).not.toHaveBeenCalled()
  })

  it('lists photos past the limit rather than dropping them', async () => {
    render(<App />)
    chooseBatch(Array.from({ length: 22 }, (_, i) => jpg(`p${i}.jpg`)))
    await screen.findByText(/2 not added — the limit is 20/i)
    expect(screen.getByText(/p20\.jpg, p21\.jpg/)).toBeTruthy()
  })

  it('detects every photo before the slow half starts, then runs them in order', async () => {
    const calls = []
    detectFaces.mockImplementation(async (file) => {
      calls.push(`detect ${file.name}`)
      if (file.name === 'blank.jpg') throw NO_FACE()
      return ONE(file.name)
    })
    analyzeFace.mockImplementation(async (token) => {
      calls.push(`analyze ${token}`)
      return analysis({ verdict: token === 'b.jpg' ? 'fake' : 'real', p: token === 'b.jpg' ? 0.9 : 0.1 })
    })

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('blank.jpg'), jpg('b.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/finished\./i)

    expect(calls).toEqual(['detect a.jpg', 'detect blank.jpg', 'detect b.jpg', 'analyze a.jpg', 'analyze b.jpg'])
    expect(within(rowFor('blank.jpg')).getByText('No face found')).toBeTruthy()
    // A photo with no face is not a Verdict of Real.
    const counter = (label) =>
      screen.getAllByText(label).find((el) => el.tagName === 'DT').nextElementSibling.textContent
    expect(counter('Read as real')).toBe('1')
    expect(counter('Read as fake')).toBe('1')
    expect(counter('No face found')).toBe('1')
  })

  it('analyses the largest face of a group photo and says which', async () => {
    detectFaces.mockImplementation(async (file) => TWO(file.name))
    analyzeFace.mockResolvedValue(analysis({ faces: 2, face: 1 }))

    render(<App />)
    chooseBatch([jpg('group.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/finished\./i)

    expect(analyzeFace).toHaveBeenCalledWith('group.jpg', 1, expect.anything())
    expect(within(rowFor('group.jpg')).getByText('Face 2 of 2')).toBeTruthy()
  })

  it('pauses when the server goes away, rather than failing every photo left', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    analyzeFace.mockResolvedValueOnce(analysis()).mockRejectedValueOnce(UNREACHABLE())
    ping.mockResolvedValue(false)

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))

    await screen.findByText(/batch is paused rather than failing every photo left/i)
    expect(within(rowFor('a.jpg')).getByText('Done')).toBeTruthy()
    // Neither b (in flight when the server went) nor c (never reached) failed.
    expect(within(rowFor('b.jpg')).queryByText('Failed')).toBeNull()
    expect(within(rowFor('c.jpg')).queryByText('Failed')).toBeNull()
    expect(analyzeFace).toHaveBeenCalledTimes(2)
    // Still down, so nothing to resume into.
    expect(screen.getByRole('button', { name: /resume/i }).disabled).toBe(true)
  })

  it('offers Resume only once the server answers, and re-detects what was waiting', async () => {
    detectFaces.mockImplementation(async (file) => ONE(`${file.name}#${detectFaces.mock.calls.length}`))
    analyzeFace.mockResolvedValueOnce(analysis()).mockRejectedValueOnce(UNREACHABLE())
    ping.mockResolvedValue(true)

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/server is answering again/i)

    analyzeFace.mockResolvedValue(analysis())
    const detectsBefore = detectFaces.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    await screen.findByText(/finished\./i)

    expect(detectFaces.mock.calls.length).toBe(detectsBefore + 1)
    expect(within(rowFor('b.jpg')).getByText('Done')).toBeTruthy()
  })

  it('keeps the queue running while a row is read, with nothing there competing for the GPU', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    const second = deferred()
    analyzeFace.mockResolvedValueOnce(analysis()).mockReturnValueOnce(second.promise)

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'a.jpg' }))

    await screen.findByText(/how the verdict was reached/i)
    expect(screen.getByText(/the queue keeps running while you read this/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /compare with another photo/i })).toBeNull()
    expect(screen.getByRole('button', { name: /draw again/i }).disabled).toBe(true)
    expect(screen.getByText(/queue is using the graphics card/i)).toBeTruthy()

    // b lands while a is being read.
    await act(async () => second.resolve(analysis({ verdict: 'fake', p: 0.9 })))
    expect(screen.getByRole('button', { name: /draw again/i }).disabled).toBe(false)

    fireEvent.click(screen.getAllByRole('button', { name: /back to the batch/i })[0])
    await screen.findByText(/finished\./i)
    expect(within(rowFor('b.jpg')).getByText('Fake')).toBeTruthy()
  })

  it('stops after the photo in flight, and keeps its result', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    const first = deferred()
    analyzeFace.mockReturnValueOnce(first.promise)

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/Running ·/)

    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }))
    await screen.findByText(/stopping after the photo in progress/i)
    await act(async () => first.resolve(analysis()))

    await screen.findByText(/stopped\./i)
    expect(within(rowFor('a.jpg')).getByText('Done')).toBeTruthy()
    expect(within(rowFor('b.jpg')).getByText('Stopped')).toBeTruthy()
    expect(analyzeFace).toHaveBeenCalledTimes(1)
  })

  it('asks before leaving a batch that has results, and stays if told no', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    analyzeFace.mockResolvedValue(analysis())

    render(<App />)
    chooseBatch([jpg('a.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/finished\./i)

    window.confirm = vi.fn(() => false)
    fireEvent.click(screen.getByRole('button', { name: /back to uploads/i }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/export the CSV first/i))
    expect(screen.getByText(/finished\./i)).toBeTruthy()
  })

  it('exports a CSV that opens with its framing', async () => {
    detectFaces.mockImplementation(async (file) => {
      if (file.name === 'blank.jpg') throw NO_FACE()
      return ONE(file.name)
    })
    analyzeFace.mockResolvedValue(analysis())

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('blank.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/finished\./i)

    let blob
    URL.createObjectURL = vi.fn((b) => ((blob = b), 'blob:csv'))
    HTMLAnchorElement.prototype.click = vi.fn()
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))

    const text = await blob.text()
    const lines = text.split('\r\n')
    expect(lines[1]).toMatch(/not an accuracy measurement/)
    expect(text).toMatch(/\r\n2,blank\.jpg,no_face,,,/)
  })

  it('re-runs a finished row, replaces its Analysis, and says so', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    // First time, the reasoning layer's reply cannot be read.
    analyzeFace.mockResolvedValueOnce({ ...analysis({ verdict: 'real', p: 0.1 }), explanation_available: false })

    render(<App />)
    chooseBatch([jpg('a.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/finished\./i)

    fireEvent.click(screen.getByRole('button', { name: 'a.jpg' }))
    await screen.findByText(/nothing this time/i)

    analyzeFace.mockResolvedValueOnce(analysis({ verdict: 'fake', p: 0.8 }))
    fireEvent.click(screen.getByRole('button', { name: /try this photo again/i }))

    // Watched from the table, since the verdict it came from is being replaced.
    await screen.findByText('Done · re-run')
    expect(within(rowFor('a.jpg')).getByText('Fake')).toBeTruthy()
    expect(analyzeFace).toHaveBeenCalledTimes(2)
  })

  it('retries failed photos once the batch ends, but not photos with no face', async () => {
    detectFaces.mockImplementation(async (file) => {
      if (file.name === 'blank.jpg') throw NO_FACE()
      return ONE(file.name)
    })
    analyzeFace
      .mockResolvedValueOnce(analysis())
      .mockRejectedValueOnce(new AnalysisError('server', 'The paging file is too small.'))

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg'), jpg('blank.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await screen.findByText(/finished\./i)
    expect(within(rowFor('b.jpg')).getByText('Failed')).toBeTruthy()
    expect(within(rowFor('b.jpg')).getByText(/paging file/i)).toBeTruthy()

    detectFaces.mockClear()
    analyzeFace.mockResolvedValueOnce(analysis({ verdict: 'fake', p: 0.9 }))
    fireEvent.click(screen.getByRole('button', { name: /try the failed photo again/i }))

    await screen.findByText(/finished\. 2 of 3/i)
    expect(within(rowFor('b.jpg')).getByText('Fake')).toBeTruthy()
    // The old failure reason goes with the failure.
    expect(within(rowFor('b.jpg')).queryByText(/paging file/i)).toBeNull()
    // Only the failed photo went back through — not the finished one, not the faceless one.
    expect(detectFaces.mock.calls.map(([file]) => file.name)).toEqual(['b.jpg'])
    expect(within(rowFor('blank.jpg')).getByText('No face found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /failed photo/i })).toBeNull()
  })

  it('offers no retry while the queue is still running', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    const second = deferred()
    analyzeFace
      .mockRejectedValueOnce(new AnalysisError('server', 'Out of memory.'))
      .mockReturnValueOnce(second.promise)

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await within(table()).findByText('Failed')

    expect(screen.queryByRole('button', { name: /failed photo/i })).toBeNull()
    await act(async () => second.resolve(analysis()))
    expect(await screen.findByRole('button', { name: /try the failed photo again/i })).toBeTruthy()
  })

  it('does not offer to re-run a row while the queue is running', async () => {
    detectFaces.mockImplementation(async (file) => ONE(file.name))
    const second = deferred()
    analyzeFace
      .mockResolvedValueOnce({ ...analysis(), explanation_available: false })
      .mockReturnValueOnce(second.promise)

    render(<App />)
    chooseBatch([jpg('a.jpg'), jpg('b.jpg')])
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'a.jpg' }))
    await screen.findByText(/nothing this time/i)

    expect(screen.queryByRole('button', { name: /try this photo again/i })).toBeNull()
    expect(screen.getByText(/available once the batch has finished or been stopped/i)).toBeTruthy()
    await act(async () => second.resolve(analysis()))
  })
})
