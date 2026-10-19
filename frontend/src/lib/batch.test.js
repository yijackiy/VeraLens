import { describe, expect, it } from 'vitest'

import {
  MAX_BATCH,
  MEAN_SECONDS,
  admit,
  counts,
  etaSeconds,
  expectedRange,
  faceLabel,
  toCsv,
} from './batch'

const photo = (name, { type = 'image/jpeg', size = 1000 } = {}) => new File(['x'.repeat(size)], name, { type })

function done(name, { verdict = 'real', p = 0.1, elapsed = 60, faces = 1, face = 0, explained = true, explanation = 'A sentence.' } = {}) {
  return {
    id: name,
    file: photo(name),
    status: 'done',
    result: {
      final_verdict: verdict,
      fake_probability: p,
      classifier_score: p,
      explanation_available: explained,
      explanation,
      faces_found: faces,
      face_index: face,
      elapsed_seconds: elapsed,
    },
  }
}
const row = (name, status) => ({ id: name, file: photo(name), status })

describe('admit', () => {
  it('keeps the chosen order and turns rejected files into rows that say why', () => {
    const { rows } = admit([photo('a.jpg'), photo('b.heic', { type: 'image/heic' }), photo('c.png', { type: 'image/png' })])
    expect(rows.map((r) => [r.file.name, r.status])).toEqual([
      ['a.jpg', 'waiting'],
      ['b.heic', 'rejected'],
      ['c.png', 'waiting'],
    ])
    expect(rows[1].reason).toMatch(/HEIC/)
  })

  it('lists files past the cap instead of dropping them, and rejected files do not count', () => {
    const files = [photo('bad.gif', { type: 'image/gif' }), ...Array.from({ length: MAX_BATCH + 2 }, (_, i) => photo(`p${i}.jpg`))]
    const { rows, notAdded } = admit(files)
    expect(rows.filter((r) => r.status === 'waiting')).toHaveLength(MAX_BATCH)
    expect(rows.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(notAdded.map((f) => f.name)).toEqual(['p20.jpg', 'p21.jpg'])
  })
})

describe('expectedRange', () => {
  it('gives the measured 10th–90th percentile, in whole minutes', () => {
    expect(expectedRange(8)).toBe('usually 9–14 minutes')
    expect(expectedRange(20)).toBe('usually 24–33 minutes')
    expect(expectedRange(0)).toBeNull()
  })
})

describe('etaSeconds', () => {
  it('uses the mean, not the median, until the batch has its own numbers', () => {
    const rows = [row('a', 'queued'), row('b', 'queued'), done('c', { elapsed: 30 })]
    expect(etaSeconds(rows)).toBe(2 * MEAN_SECONDS)
  })

  it("switches to this batch's own average after three photos", () => {
    const rows = [done('a', { elapsed: 40 }), done('b', { elapsed: 50 }), done('c', { elapsed: 60 }), row('d', 'queued')]
    expect(etaSeconds(rows)).toBe(50)
  })

  it('counts what the running photo has not used up, never less than nothing', () => {
    const rows = [row('a', 'running'), row('b', 'queued')]
    expect(etaSeconds(rows, 30)).toBe(MEAN_SECONDS + (MEAN_SECONDS - 30))
    // A photo past the average is in the tail, not "nearly done".
    expect(etaSeconds(rows, 500)).toBe(MEAN_SECONDS)
  })

  it('is null when nothing is left to run', () => {
    expect(etaSeconds([done('a'), row('b', 'no_face'), row('c', 'stopped')])).toBeNull()
  })
})

describe('counts', () => {
  it('never counts a photo with no face as Real', () => {
    const c = counts([done('a', { verdict: 'real' }), done('b', { verdict: 'fake' }), row('c', 'no_face'), row('d', 'queued')])
    expect(c).toMatchObject({ real: 1, fake: 1, noFace: 1, queued: 1 })
  })
})

describe('faceLabel', () => {
  it('names the face only when there was a choice to make', () => {
    expect(faceLabel(done('a', { faces: 4, face: 1 }))).toBe('Face 2 of 4')
    expect(faceLabel(done('a', { faces: 1 }))).toBeNull()
    // Known from /detect before the photo has run.
    expect(faceLabel({ status: 'queued', facesFound: 3, faceIndex: 2 })).toBe('Face 3 of 3')
  })
})

describe('toCsv', () => {
  const lines = (csv) => csv.trimEnd().split('\r\n')

  it('opens with the framing, before any data', () => {
    const out = lines(toCsv([done('a.jpg')], new Date('2026-10-02T10:00:00Z')))
    expect(out[0]).toBe('# VeraLens batch export, 2026-10-02T10:00:00.000Z')
    expect(out[1]).toMatch(/not an accuracy measurement/)
    expect(out.slice(0, 6).every((l) => l.startsWith('#'))).toBe(true)
    expect(out[6]).toMatch(/^index,file,status,fake_probability,verdict,classifier_score/)
  })

  it('leaves a photo with no face without a verdict', () => {
    const out = lines(toCsv([row('blank.png', 'no_face')]))
    expect(out[7]).toBe('1,blank.png,no_face,,,,,,,,false,')
  })

  it('quotes what needs quoting', () => {
    const out = lines(toCsv([done('a, b.jpg', { explanation: 'It said "real", then\nstopped.' })]))
    expect(out.slice(7).join('\r\n')).toContain('"a, b.jpg"')
    expect(out.slice(7).join('\r\n')).toContain('"It said ""real"", then\nstopped."')
  })

  it('does not let a file name run as a spreadsheet formula', () => {
    const out = lines(toCsv([done('=HYPERLINK("x").jpg')]))
    expect(out[7]).toContain(`"'=HYPERLINK(""x"").jpg"`)
  })

  it('leaves out the placeholder text of a Draw with no explanation', () => {
    const out = lines(toCsv([done('a.jpg', { explained: false, explanation: 'Parsing failed — raw output logged for debugging.' })]))
    expect(out[7]).not.toMatch(/Parsing failed/)
  })
})
