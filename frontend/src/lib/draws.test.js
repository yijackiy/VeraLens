import { describe, expect, it } from 'vitest'

import {
  MAX_DRAWS,
  canDrawAgain,
  drawsOf,
  isDrawOf,
  severityRows,
  verdictChanges,
  withSignals,
  withoutExplanation,
} from './draws'

const CHECKLIST = [
  'hairline boundary consistency',
  'eye highlight symmetry',
  'skin texture consistency',
  'lighting direction consistency',
  'edge blending around the face contour',
]

/** A Draw as /analyze returns it. `severities` maps onto the checklist. */
function draw(severities, { verdict = 'fake', classifier = 0.93, explained = true } = {}) {
  return {
    final_verdict: verdict,
    fake_probability: 0.8,
    classifier_score: classifier,
    explanation_available: explained,
    explanation: explained ? 'A sentence.' : 'Parsing failed — raw output logged for debugging.',
    signals: explained
      ? severities.map((severity, i) => ({ name: CHECKLIST[i], severity, note: 'n' }))
      : [],
  }
}

const row = (draws, name) => severityRows(draws).find((r) => r.name === name)

describe('isDrawOf', () => {
  it('accepts GPU jitter in the classifier score', () => {
    expect(isDrawOf(draw([], { classifier: 0.93 }), draw([], { classifier: 0.9300003 }))).toBe(true)
  })

  it('rejects a different reading — a different face or a different measurement', () => {
    expect(isDrawOf(draw([], { classifier: 0.93 }), draw([], { classifier: 0.61 }))).toBe(false)
  })
})

describe('drawsOf', () => {
  it('counts Draw 1 and drawn entries, never failed requests or mismatches', () => {
    const analysis = draw([0.8])
    const entries = [
      { status: 'drawn', result: draw([0.7]) },
      { status: 'failed', detail: 'unreachable' },
      { status: 'mismatch', result: draw([0.1], { classifier: 0.2 }) },
      { status: 'drawn', result: draw([], { explained: false }) },
    ]
    const draws = drawsOf(analysis, entries)
    expect(draws).toHaveLength(3)
    expect(draws[0]).toBe(analysis)
  })
})

describe('canDrawAgain', () => {
  it('stops at the cap and while one is running', () => {
    const four = Array.from({ length: MAX_DRAWS - 1 }, () => draw([0.8]))
    expect(canDrawAgain(four, false)).toBe(true)
    expect(canDrawAgain(four, true)).toBe(false)
    expect(canDrawAgain([...four, draw([0.8])], false)).toBe(false)
  })
})

describe('verdictChanges and explanation counts', () => {
  it('reports which Draws would have reached a different Verdict', () => {
    const draws = [draw([]), draw([]), draw([], { verdict: 'real' }), draw([])]
    expect(verdictChanges(draws)).toEqual([3])
  })

  it('counts a Draw with no explanation as a Draw, and says so', () => {
    const draws = [draw([0.8]), draw([], { explained: false }), draw([0.7])]
    expect(withoutExplanation(draws)).toBe(1)
    expect(withSignals(draws)).toBe(2)
  })
})

describe('severityRows', () => {
  it('does not call routine 0.1 jitter across the band edge a move', () => {
    // 0.7 is High and 0.6 is Medium. Bands would call this a change; it is
    // the model's smallest routine step.
    const r = row([draw([0.7]), draw([0.6]), draw([0.7])], CHECKLIST[0])
    expect(r.moved).toBe(false)
  })

  it('counts a swing of exactly the threshold, despite floating point', () => {
    // 0.7 - 0.4 === 0.29999999999999993 and 0.95 - 0.65 === 0.2999999999999999.
    expect(row([draw([0.7]), draw([0.4])], CHECKLIST[0]).moved).toBe(true)
    expect(row([draw([0.95]), draw([0.65])], CHECKLIST[0]).moved).toBe(true)
  })

  it('tells the direction relative to Draw 1', () => {
    expect(row([draw([0.9]), draw([0.85]), draw([0.5])], CHECKLIST[0]).direction).toBe('less')
    expect(row([draw([0.4]), draw([0.8])], CHECKLIST[0]).direction).toBe('more')
  })

  it('says "varied" rather than pick a side when Draw 1 is in the middle', () => {
    // Moved (spread 0.8) but it swung both ways, a full threshold each side.
    expect(row([draw([0.5]), draw([0.1]), draw([0.9])], CHECKLIST[0]).direction).toBe('varied')
    // Moved (spread 0.35) but no single Draw is 0.3 from Draw 1.
    expect(row([draw([0.6]), draw([0.45]), draw([0.8])], CHECKLIST[0]).direction).toBe('varied')
  })

  it('says "varied" when Draw 1 has no rating to measure from', () => {
    const draws = [draw([], { explained: false }), draw([0.9]), draw([0.5])]
    expect(row(draws, CHECKLIST[0])).toMatchObject({ moved: true, direction: 'varied' })
  })

  it('leaves Draws with no explanation out of the spread, not as zeros', () => {
    const draws = [draw([0.9]), draw([], { explained: false }), draw([0.85])]
    const r = row(draws, CHECKLIST[0])
    expect(r.severities).toEqual([0.9, null, 0.85])
    expect(r.moved).toBe(false)
  })

  it('does not call a single rating a move', () => {
    expect(row([draw([0.9]), draw([], { explained: false })], CHECKLIST[0]).moved).toBe(false)
  })

  it('matches signal names case-insensitively and keeps the first spelling', () => {
    const a = draw([0.9])
    const b = draw([0.5])
    b.signals[0].name = '  Hairline Boundary Consistency '
    const r = severityRows([a, b])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: CHECKLIST[0], moved: true, direction: 'less' })
  })

  it('reads every checklist signal independently', () => {
    const rows = severityRows([
      draw([0.9, 0.8, 0.7, 0.6, 0.5]),
      draw([0.9, 0.4, 0.7, 0.6, 0.9]),
    ])
    expect(rows.map((r) => r.moved)).toEqual([false, true, false, false, true])
  })
})
