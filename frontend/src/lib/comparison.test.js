import { describe, expect, it } from 'vitest'

import {
  agreementSummary,
  comparisonOf,
  gapBetween,
  heldFrom,
  layersAgreed,
  pinPosition,
  sameVerdict,
} from './comparison'

/**
 * fake_probability is the fused number: 0.55 of the classifier plus 0.45 of the
 * reasoning layer. The fixtures below compute it that way rather than stating
 * an unrelated value, because layersAgreed() recovers the reasoning layer's own
 * probability by inverting exactly that arithmetic.
 */
function analysis({ classifier, reasoning, explanationAvailable = true }) {
  const fused = 0.55 * classifier + 0.45 * reasoning
  return {
    classifier_score: classifier,
    fake_probability: fused,
    final_verdict: fused > 0.5 ? 'fake' : 'real',
    explanation_available: explanationAvailable,
  }
}

function side(label, result, name = `${label}.jpg`) {
  return { label, result, photo: { file: { name }, url: `blob:${name}` } }
}

const CONFIDENT_FAKE = analysis({ classifier: 0.96, reasoning: 0.85 })
const CONFIDENT_REAL = analysis({ classifier: 0.06, reasoning: 0.1 })
const SPLIT = analysis({ classifier: 0.92, reasoning: 0.2 })
const DEGRADED = { ...analysis({ classifier: 0.9, reasoning: 0 }), explanation_available: false }

describe('heldFrom', () => {
  it('parks a photo with its analysis', () => {
    const photo = { file: { name: 'a.jpg' }, url: 'blob:a' }
    expect(heldFrom(photo, CONFIDENT_REAL)).toEqual({ photo, result: CONFIDENT_REAL })
  })

  it('refuses to hold half a pair', () => {
    expect(heldFrom(null, CONFIDENT_REAL)).toBeNull()
    expect(heldFrom({ url: 'blob:a' }, null)).toBeNull()
  })
})

describe('comparisonOf', () => {
  it('puts the held analysis first, always', () => {
    const held = heldFrom({ file: { name: 'first.jpg' }, url: 'blob:1' }, CONFIDENT_REAL)
    const comparison = comparisonOf(held, { file: { name: 'second.jpg' }, url: 'blob:2' }, CONFIDENT_FAKE)

    expect(comparison.a.label).toBe('A')
    expect(comparison.a.photo.file.name).toBe('first.jpg')
    expect(comparison.b.label).toBe('B')
    expect(comparison.b.photo.file.name).toBe('second.jpg')
  })

  it('is null until both halves exist', () => {
    expect(comparisonOf(null, { url: 'blob:2' }, CONFIDENT_FAKE)).toBeNull()
    expect(comparisonOf({ photo: {}, result: CONFIDENT_REAL }, null, CONFIDENT_FAKE)).toBeNull()
  })
})

describe('gapBetween', () => {
  it('is a distance, so the order of the arguments cannot change it', () => {
    const a = side('A', CONFIDENT_REAL)
    const b = side('B', CONFIDENT_FAKE)
    expect(gapBetween(a, b)).toBeCloseTo(gapBetween(b, a), 10)
  })

  it('is zero for a photo against itself', () => {
    const a = side('A', CONFIDENT_FAKE)
    expect(gapBetween(a, side('B', CONFIDENT_FAKE))).toBe(0)
  })
})

describe('sameVerdict', () => {
  it('compares the verdict, not the distance', () => {
    // Two Real verdicts far apart on the scale are still the same verdict —
    // the point of showing the gap separately.
    const near = side('A', analysis({ classifier: 0.02, reasoning: 0.02 }))
    const far = side('B', analysis({ classifier: 0.45, reasoning: 0.45 }))

    expect(sameVerdict(near, far)).toBe(true)
    expect(gapBetween(near, far)).toBeGreaterThan(0.4)
  })

  it('sees a difference across the threshold', () => {
    expect(sameVerdict(side('A', CONFIDENT_REAL), side('B', CONFIDENT_FAKE))).toBe(false)
  })
})

describe('layersAgreed', () => {
  it('is true when both land on the same side of the threshold', () => {
    expect(layersAgreed(CONFIDENT_FAKE)).toBe(true)
    expect(layersAgreed(CONFIDENT_REAL)).toBe(true)
  })

  it('is false when they disagree', () => {
    expect(layersAgreed(SPLIT)).toBe(false)
  })

  // An unreadable reply is the absence of an opinion. Counting it as a
  // disagreement would invent a conflict that never happened.
  it('is null, not false, when the reasoning layer could not be read', () => {
    expect(layersAgreed(DEGRADED)).toBeNull()
  })
})

describe('agreementSummary', () => {
  it('names which photos had agreeing layers', () => {
    expect(agreementSummary(side('A', CONFIDENT_FAKE), side('B', CONFIDENT_REAL))).toBe('Both photos')
    expect(agreementSummary(side('A', CONFIDENT_FAKE), side('B', SPLIT))).toBe('Photo A only')
    expect(agreementSummary(side('A', SPLIT), side('B', CONFIDENT_FAKE))).toBe('Photo B only')
    expect(agreementSummary(side('A', SPLIT), side('B', SPLIT))).toBe('Neither')
  })

  it('says so rather than guessing when a reply was unreadable', () => {
    expect(agreementSummary(side('A', DEGRADED), side('B', CONFIDENT_FAKE))).toBe(
      'Photo B (A unreadable)',
    )
    expect(agreementSummary(side('A', CONFIDENT_FAKE), side('B', DEGRADED))).toBe(
      'Photo A (B unreadable)',
    )
    expect(agreementSummary(side('A', DEGRADED), side('B', DEGRADED))).toBe('Not readable')
  })
})

describe('pinPosition', () => {
  it('maps a probability onto the axis', () => {
    expect(pinPosition(0)).toBe(0)
    expect(pinPosition(0.5)).toBe(50)
    expect(pinPosition(1)).toBe(100)
  })

  // fake_probability is a weighted sum of two numbers the models produced, and
  // nothing upstream clamps it. A pin outside the track would be positioned
  // off the card entirely.
  it('keeps a pin on the track whatever it is handed', () => {
    expect(pinPosition(1.4)).toBe(100)
    expect(pinPosition(-0.2)).toBe(0)
  })
})
