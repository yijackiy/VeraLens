import { describe, expect, it } from 'vitest'

import { recommendedFaceIndex } from './faces'

/**
 * The rule that decides which Face Candidate runs when nobody chooses.
 *
 * Two of these tests exist because of bugs that shipped. `prefers the largest
 * face over the leftmost one` is the disagreement the picker had with itself:
 * it highlighted the largest face and then analysed the leftmost one whenever
 * a caller skipped the picker. `breaks a tie` is the predicate bug: the old
 * `area === max(area)` form was satisfied by every face of equal area at once,
 * so the picker outlined two recommendations and the fallback's answer
 * depended on iteration order.
 */

/** Faces as /detect sends them: `index` is position in left-to-right order. */
function face(index, { width, height, det_score = 0.9, x = index * 1000 }) {
  return {
    index,
    bbox: [x, 0, x + width, height],
    det_score,
    width,
    height,
  }
}

describe('recommendedFaceIndex', () => {
  it('returns null for no faces', () => {
    expect(recommendedFaceIndex([])).toBeNull()
    expect(recommendedFaceIndex(null)).toBeNull()
  })

  it('returns the only face', () => {
    expect(recommendedFaceIndex([face(0, { width: 100, height: 100 })])).toBe(0)
  })

  it('prefers the largest face over the leftmost one', () => {
    const faces = [
      face(0, { width: 40, height: 40 }), // leftmost, and the old answer
      face(1, { width: 300, height: 380 }),
      face(2, { width: 60, height: 60 }),
    ]
    expect(recommendedFaceIndex(faces)).toBe(1)
  })

  it('compares area, not either dimension alone', () => {
    const faces = [
      face(0, { width: 400, height: 20 }), // widest
      face(1, { width: 100, height: 100 }), // largest by area
    ]
    expect(recommendedFaceIndex(faces)).toBe(1)
  })

  it('breaks a tie on det_score, and returns exactly one face', () => {
    const faces = [
      face(0, { width: 200, height: 200, det_score: 0.71 }),
      face(1, { width: 200, height: 200, det_score: 0.94 }),
      face(2, { width: 200, height: 200, det_score: 0.83 }),
    ]
    expect(recommendedFaceIndex(faces)).toBe(1)
  })

  it('still answers when area and det_score are both tied', () => {
    const faces = [
      face(0, { width: 200, height: 200, det_score: 0.9 }),
      face(1, { width: 200, height: 200, det_score: 0.9 }),
    ]
    // Which one is arbitrary; that there is exactly one is not.
    expect([0, 1]).toContain(recommendedFaceIndex(faces))
  })

  it('reads `index` off the face rather than assuming array position', () => {
    // The backend numbers faces in the order it sends them, so these agree
    // today. Reading the field is what keeps that an assumption of the
    // protocol rather than of this function.
    const faces = [
      { index: 7, bbox: [0, 0, 40, 40], det_score: 0.9, width: 40, height: 40 },
      { index: 3, bbox: [0, 0, 90, 90], det_score: 0.9, width: 90, height: 90 },
    ]
    expect(recommendedFaceIndex(faces)).toBe(3)
  })
})
