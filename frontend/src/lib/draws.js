/**
 * Draws — asking the reasoning layer again about the same Face Crop.
 *
 * The reasoning layer samples (ADR 0013), so each Draw can rate the five
 * checklist signals differently, word its explanation differently, or fail to
 * produce one. Everything here is about reading those differences honestly.
 *
 * Draw 1 is always the Analysis itself: its Verdict and explanation are the
 * ones the page leads with, and later Draws add evidence about them without
 * replacing them (CONTEXT.md, "Draw").
 */

/** One Draw per click, and the page stops offering more at five. Three is the
 *  fewest that separates one odd Draw from a pattern; past five the severity
 *  table stops fitting on a screen. A limit on legibility, not on statistics. */
export const MAX_DRAWS = 5

/**
 * A signal counts as "moved" when its severities across Draws span at least
 * this much. A chosen threshold, not a measured one — nothing in this project
 * is ground truth for a meaningfully different severity. It governs only the
 * plain-language sentence; the technical register shows every raw value.
 *
 * Why not severity bands: the High/Medium edge (0.7) sits on the model's
 * second most common severity, with its commonest neighbours at 0.6 and 0.8,
 * so band changes would report the model's routine 0.1 jitter as a change.
 */
export const SPREAD_THRESHOLD = 0.3

/**
 * 0.7 - 0.4 is 0.29999999999999993 and 0.95 - 0.65 is 0.2999999999999999 in
 * IEEE-754, and the model uses all four of those values. Without this, two
 * of the commonest swings exactly at the threshold would be quietly ruled
 * "not moved".
 */
const EPSILON = 1e-9

/**
 * How close a re-submission's classifier score must be to count as a Draw of
 * this Analysis. Not exact equality: cuDNN is not set deterministic, so the
 * classifier on GPU can differ around the seventh decimal between runs of the
 * same crop. Anything larger means a different face or a different
 * measurement, and the comparison would be between two different things.
 */
export const SCORE_TOLERANCE = 1e-4

/** Is `candidate` a Draw of `analysis` — the same face, the same classifier
 *  reading, differing only in the reasoning layer's contribution? */
export function isDrawOf(analysis, candidate) {
  return Math.abs(analysis.classifier_score - candidate.classifier_score) < SCORE_TOLERANCE
}

/**
 * The Draws that count, Draw 1 first. `entries` are the page's later
 * attempts, which may include requests that failed (no Draw happened) and
 * results that turned out not to be Draws of this Analysis — neither counts.
 * A Draw that ran but produced no explanation does count: that failure is
 * part of what asking again found out.
 */
export function drawsOf(analysis, entries) {
  return [analysis, ...entries.filter((entry) => entry.status === 'drawn').map((e) => e.result)]
}

export function canDrawAgain(draws, inFlight) {
  return !inFlight && draws.length < MAX_DRAWS
}

/** Draw numbers (1-based) whose Verdict differs from Draw 1's. */
export function verdictChanges(draws) {
  const first = draws[0].final_verdict
  return draws.flatMap((draw, index) => (draw.final_verdict !== first ? [index + 1] : []))
}

/** How many Draws produced no explanation the pipeline could read. */
export function withoutExplanation(draws) {
  return draws.filter((draw) => !draw.explanation_available).length
}

/** How many Draws produced signals to compare. */
export function withSignals(draws) {
  return draws.filter((draw) => draw.explanation_available).length
}

const keyOf = (name) => name.trim().toLowerCase()

/**
 * One row per signal: its severity in each Draw (null where that Draw has
 * none), the spread, whether it moved, and which way relative to Draw 1.
 *
 * Signals are matched on name. That is safe here rather than hopeful: on the
 * production prompt the model returned exactly the five checklist names, all
 * five, in 955 of 955 signals across 191 draws — the name carries no
 * information, only the severity does.
 */
export function severityRows(draws) {
  const order = []
  const display = new Map()
  for (const draw of draws) {
    for (const signal of draw.explanation_available ? draw.signals || [] : []) {
      const key = keyOf(signal.name || '')
      if (!key || display.has(key)) continue
      display.set(key, signal.name.trim())
      order.push(key)
    }
  }

  return order.map((key) => {
    const severities = draws.map((draw) => {
      if (!draw.explanation_available) return null
      const signal = (draw.signals || []).find((s) => keyOf(s.name || '') === key)
      return signal && typeof signal.severity === 'number' ? signal.severity : null
    })
    const present = severities.filter((s) => s !== null)
    const spread = present.length >= 2 ? Math.max(...present) - Math.min(...present) : 0
    const moved = present.length >= 2 && spread >= SPREAD_THRESHOLD - EPSILON

    return {
      name: display.get(key),
      severities,
      spread,
      moved,
      direction: moved ? directionFrom(severities) : null,
    }
  })
}

/**
 * Which way a moved signal went, told relative to Draw 1 — the rating the
 * page shows above. "more"/"less" only when some later Draw sits a full
 * threshold away from Draw 1 in that direction; otherwise "varied", which
 * covers Draw 1 sitting in the middle of the spread, or having no rating at
 * all. Saying "much less serious" about a 0.15 difference would overstate it.
 */
function directionFrom(severities) {
  const [first, ...rest] = severities
  if (first === null) return 'varied'
  const others = rest.filter((s) => s !== null)
  const up = Math.max(...others) - first >= SPREAD_THRESHOLD - EPSILON
  const down = first - Math.min(...others) >= SPREAD_THRESHOLD - EPSILON
  // Both at once is a swing either side of Draw 1, not a direction.
  if (up && !down) return 'more'
  if (down && !up) return 'less'
  return 'varied'
}
