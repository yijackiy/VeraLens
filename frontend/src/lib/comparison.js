import { THRESHOLD, reasoningFakeProbability } from './analysis'

/**
 * A Comparison reads two Analyses against one shared scale.
 *
 * It deliberately computes almost nothing. Putting two Fake Probabilities on
 * the same axis makes them easy to read against each other; it does not make
 * either more certain, and there is no combined score here because there is no
 * defensible way to produce one. The gap is a distance, not a finding.
 */

/** What the held slot carries: the photo the browser still owns, and its Analysis. */
export function heldFrom(photo, result) {
  if (!photo || !result) return null
  return { photo, result }
}

/**
 * A always precedes B in submission order, so the pins on the axis and the
 * cards below cannot disagree about which photo is which.
 */
export function comparisonOf(held, photo, result) {
  if (!held || !photo || !result) return null
  return {
    a: { label: 'A', photo: held.photo, result: held.result },
    b: { label: 'B', photo, result },
  }
}

export function gapBetween(a, b) {
  return Math.abs(a.result.fake_probability - b.result.fake_probability)
}

export function sameVerdict(a, b) {
  return a.result.final_verdict === b.result.final_verdict
}

/**
 * Did the classifier and the reasoning layer land on the same side of the
 * threshold for this Analysis? null when the reasoning layer's reply could not
 * be read, which is not the same as a disagreement and must not be counted as
 * one.
 */
export function layersAgreed(result) {
  const reasoning = reasoningFakeProbability(result)
  if (reasoning === null) return null
  const classifierSaysFake = result.classifier_score > THRESHOLD
  const reasoningSaysFake = reasoning > THRESHOLD
  return classifierSaysFake === reasoningSaysFake
}

/** Wording for the summary strip, including the case where nobody can say. */
export function agreementSummary(a, b) {
  const first = layersAgreed(a.result)
  const second = layersAgreed(b.result)

  if (first === null && second === null) return 'Not readable'
  if (first === null) return second ? 'Photo B (A unreadable)' : 'Neither (A unreadable)'
  if (second === null) return first ? 'Photo A (B unreadable)' : 'Neither (B unreadable)'

  if (first && second) return 'Both photos'
  if (first) return 'Photo A only'
  if (second) return 'Photo B only'
  return 'Neither'
}

/** Position on the 0-1 axis, as a percentage, clamped so a pin cannot escape. */
export function pinPosition(probability) {
  return Math.min(100, Math.max(0, probability * 100))
}
