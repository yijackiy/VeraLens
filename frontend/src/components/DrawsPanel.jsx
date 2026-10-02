import { Button } from './Button'
import { Icon } from './Icon'
import { formatClock, percent } from '../lib/analysis'
import {
  MAX_DRAWS,
  SPREAD_THRESHOLD,
  canDrawAgain,
  drawsOf,
  severityRows,
  verdictChanges,
  withSignals,
  withoutExplanation,
} from '../lib/draws'

/**
 * Asking the reasoning layer again about the same face (CONTEXT.md, "Draw").
 *
 * What this panel can show is narrower than it looks, and the copy is written
 * to that width. On the production prompt the reasoning layer agreed with the
 * classifier on every one of 191 parsed draws, and returned exactly the same
 * five signal names every time. So a Verdict flip is rare, and *which*
 * signals it cites never varies — what can vary is how serious it rates
 * each one, whether it produces an explanation at all, and its wording.
 * That is what this panel compares, and all it compares (ADR 0013).
 *
 * Both registers carry the findings, because the reader most likely to take
 * an explanation at its word is the one reading in plain language. Technical
 * adds the table of raw ratings the findings are computed from, which keeps
 * Plain a strict reduction of Technical.
 */
export function DrawsPanel({
  analysis,
  entries,
  inFlight,
  elapsed,
  technical,
  onDrawAgain,
  onCancel,
  unavailable = null,
}) {
  const draws = drawsOf(analysis, entries)
  // `unavailable` is a reason, not a flag: a Batch row cannot draw while the
  // queue holds the graphics card, and a greyed button with no reason reads
  // as broken.
  const allowed = !unavailable && canDrawAgain(draws, inFlight)
  const atCap = draws.length >= MAX_DRAWS

  return (
    <section className="flex flex-col gap-6">
      <h2 className="m-0 border-b border-line pb-2 text-headline-sm font-semibold text-ink-strong">
        Asking again
      </h2>

      <div className="flex flex-col gap-6 rounded-2xl border border-line bg-paper p-6 shadow-ambient md:p-8">
        <div className="flex flex-col gap-2">
          <p className="m-0 max-w-3xl text-body-md text-ink-muted">
            The reasoning layer samples its answer, so asking it again about this same face can come
            back different. Each Draw asks once more — about a minute, sometimes three — and never
            changes the Verdict above.
          </p>
          {technical && (
            <p className="m-0 max-w-3xl text-body-sm text-ink-muted">
              A Draw re-submits the photo. The classifier and Saliency Map run again and must match
              Draw 1's to within 0.0001, so the only part that differs is the reasoning layer's
              contribution; a result that does not match is shown but left out.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="secondary"
            onClick={onDrawAgain}
            disabled={!allowed}
            className="px-6 py-2.5 text-body-sm"
          >
            <Icon name="replay" size={18} />
            Draw again
          </Button>
          <span className="font-mono text-data-mono text-ink-muted">
            {atCap ? `All ${MAX_DRAWS} Draws used` : `${draws.length} of ${MAX_DRAWS} Draws`}
          </span>
          {unavailable && <span className="text-body-sm text-ink-muted">{unavailable}</span>}
        </div>

        {inFlight && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sage-tint px-5 py-4">
            <div className="flex items-start gap-3">
              <Icon name="hourglass_top" className="vl-blink mt-0.5 text-sage-ink" size={20} />
              <p className="m-0 text-body-sm text-sage-ink">
                Draw {draws.length + 1} running — {formatClock(elapsed)} so far. The graphics card
                finishes it either way; stopping only closes the page on it.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="label-caps cursor-pointer rounded-lg border border-sage-deep bg-transparent px-4 py-2 text-sage-ink hover:bg-sage-tint"
            >
              Stop waiting
            </button>
          </div>
        )}

        {/* Announced when a Draw lands: the result arrives a minute after the
            click, long after anyone using a screen reader has moved on. */}
        <div aria-live="polite" className="flex flex-col gap-6">
          {draws.length >= 2 && <Findings draws={draws} technical={technical} />}
          {entries.length > 0 && <LaterDraws entries={entries} analysis={analysis} />}
        </div>
      </div>
    </section>
  )
}

function Findings({ draws, technical }) {
  const changed = verdictChanges(draws)
  const unexplained = withoutExplanation(draws)
  const rated = withSignals(draws)
  const rows = severityRows(draws)
  const moved = rows.filter((row) => row.moved)
  const firstVerdict = draws[0].final_verdict === 'fake' ? 'Fake' : 'Real'
  const otherVerdict = firstVerdict === 'Fake' ? 'Real' : 'Fake'

  return (
    <div className="flex flex-col gap-4">
      {changed.length > 0 && (
        // The one finding here that is a genuine caution: this Verdict
        // depends on which answer the reasoning layer happened to give.
        <div className="flex items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4">
          <Icon name="warning" className="mt-0.5 flex-shrink-0 text-terracotta-ink" size={22} />
          <p className="m-0 text-body-sm text-terracotta-deep">
            {listOf(changed.map((n) => `Draw ${n}`))} would have reached a different Verdict —{' '}
            {otherVerdict}, not {firstVerdict}. The Verdict above is Draw 1's and stands; this shows
            how much it depends on one answer from the reasoning layer.
          </p>
        </div>
      )}

      {unexplained > 0 && (
        <p className="m-0 text-body-sm text-ink-muted">
          {unexplained} of {draws.length} Draws produced no explanation VeraLens could read.
        </p>
      )}

      {rated < 2 ? (
        <p className="m-0 text-body-sm text-ink-muted">
          Only one Draw produced signals to rate, so there is nothing to compare yet.
        </p>
      ) : moved.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-body-md text-ink-strong">
            Asked again, the reasoning layer changed how serious it rated{' '}
            {moved.length === 1 ? 'one signal' : `${moved.length} signals`}:
          </p>
          <ul className="m-0 flex flex-col gap-1.5 pl-5 text-body-sm text-ink-muted">
            {moved.map((row) => (
              <li key={row.name}>
                <span className="font-semibold text-ink-strong">{row.name}</span> —{' '}
                {DIRECTION_WORDS[row.direction]}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-0 text-body-md text-ink-strong">
          Across the {rated} Draws that rated them, the reasoning layer rated every signal about the
          same. That's consistency, not confirmation: each time, it was told what the classifier had
          found.
        </p>
      )}

      {technical && <SeverityTable draws={draws} rows={rows} />}
    </div>
  )
}

const DIRECTION_WORDS = {
  more: 'rated much more serious than in Draw 1',
  less: 'rated much less serious than in Draw 1',
  varied: 'rated very differently from one Draw to the next',
}

function SeverityTable({ draws, rows }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-container">
              <th scope="col" className="label-caps px-4 py-3 text-ink-muted">
                Signal
              </th>
              {draws.map((_, index) => (
                <th key={index} scope="col" className="label-caps px-3 py-3 text-right text-ink-muted">
                  Draw {index + 1}
                </th>
              ))}
              <th scope="col" className="label-caps px-4 py-3 text-right text-ink-muted">
                Spread
              </th>
            </tr>
          </thead>
          <tbody className="font-mono text-data-mono">
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <th scope="row" className="px-4 py-2.5 font-sans text-body-sm font-normal text-ink">
                  {row.name}
                </th>
                {row.severities.map((severity, index) => (
                  <td key={index} className="px-3 py-2.5 text-right text-ink-strong">
                    {severity === null ? '—' : severity.toFixed(2)}
                  </td>
                ))}
                <td
                  className={`px-4 py-2.5 text-right ${
                    row.moved ? 'font-bold text-terracotta-ink' : 'text-ink-muted'
                  }`}
                >
                  {row.spread.toFixed(2)}
                  {row.moved && <span className="sr-only"> (moved)</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line">
              <th scope="row" className="px-4 py-2.5 font-sans text-body-sm font-normal text-ink">
                Fused Fake Probability
              </th>
              {draws.map((draw, index) => (
                <td key={index} className="px-3 py-2.5 text-right text-ink-strong">
                  {percent(draw.fake_probability)}
                </td>
              ))}
              <td />
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="px-4 py-2.5 font-sans text-body-sm font-normal text-ink">
                Verdict
              </th>
              {draws.map((draw, index) => (
                <td key={index} className="px-3 py-2.5 text-right text-ink-strong">
                  {draw.final_verdict === 'fake' ? 'Fake' : 'Real'}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="m-0 text-body-sm text-outline">
        A signal counts as moved when its ratings span {SPREAD_THRESHOLD.toFixed(2)} or more across
        Draws — a threshold chosen for this page, not a measured one (ADR 0013). Every rating is
        shown, so you can apply your own. A dash is a Draw that produced no explanation.
      </p>
    </div>
  )
}

/** Every later attempt, in the order it happened — including the ones that
 *  are not Draws, so nothing that ran is hidden. */
function LaterDraws({ entries, analysis }) {
  // Only real Draws get a number; failed requests and mismatches sit between
  // them in the order they happened, unnumbered.
  const numbers = new Map()
  entries
    .filter((entry) => entry.status === 'drawn')
    .forEach((entry, index) => numbers.set(entry.id, index + 2))

  return (
    <div className="flex flex-col gap-3">
      <p className="label-caps m-0 text-ink-muted">What each Draw wrote · Draw 1 is above</p>
      {entries.map((entry) => {
        if (entry.status === 'failed') {
          return (
            <p key={entry.id} className="m-0 rounded-lg bg-container-high px-4 py-3 text-body-sm text-ink-muted">
              That request didn't produce a Draw: {entry.detail} It doesn't count toward the{' '}
              {MAX_DRAWS}.
            </p>
          )
        }
        if (entry.status === 'mismatch') {
          return (
            <p key={entry.id} className="m-0 rounded-lg bg-container-high px-4 py-3 text-body-sm text-ink-muted">
              Not a Draw of this Analysis — the classifier read{' '}
              {percent(entry.result.classifier_score)} against Draw 1's{' '}
              {percent(analysis.classifier_score)}, so it measured something different. Left out of
              everything above.
            </p>
          )
        }
        const { result } = entry
        return (
          <div key={entry.id} className="flex flex-col gap-1 border-l-2 border-outline-variant pl-3">
            <span className="label-caps text-ink-muted">Draw {numbers.get(entry.id)}</span>
            {result.explanation_available ? (
              <p className="m-0 text-body-sm text-ink">{result.explanation}</p>
            ) : (
              <p className="m-0 text-body-sm text-ink-muted italic">
                No explanation this time — the reply could not be read.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function listOf(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
