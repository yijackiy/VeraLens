import { useEffect, useState } from 'react'

import { ping } from '../api/client'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { RegisterToggle } from '../components/RegisterToggle'
import { useElapsed } from '../hooks/useElapsed'
import { useRegister } from '../hooks/useRegister'
import { formatClock, formatElapsed } from '../lib/analysis'
import { counts, display, etaSeconds, expectedRange, faceLabel, runnable, toCsv } from '../lib/batch'

/**
 * A Batch as a table (CONTEXT.md, "Batch").
 *
 * The page is careful about two things. It never presents its counts as an
 * accuracy figure — a folder of labelled dataset images would make "read as
 * fake 19, read as real 1" look like a measurement, and it is not one. And it
 * never lets a photo with no face read as Real: those rows stay in the table,
 * saying what happened, because dropping them is how eight results become
 * four.
 */
export function BatchScreen({
  rows,
  notAdded,
  stage,
  onStart,
  onStop,
  onResume,
  onRetryFailed,
  onOpen,
  onLeave,
  onHowItWorks,
}) {
  const { register, setRegister, technical } = useRegister()
  const running = rows.find((row) => row.status === 'running')
  const runningElapsed = useElapsed(running?.startedAt ?? null)
  const toRun = runnable(rows).length
  const c = counts(rows)

  return (
    <Page width="wide" textured onHome={onLeave} onHelp={onHowItWorks}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onLeave}
          className="flex w-fit cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-ink-muted hover:text-terracotta-ink"
        >
          <Icon name="arrow_back" size={20} />
          <span className="label-caps">Back to uploads</span>
        </button>
        <RegisterToggle register={register} onChange={setRegister} />
      </div>

      <section className="flex flex-col gap-6 rounded-3xl border border-line bg-paper p-8 shadow-ambient md:p-12">
        <div className="flex flex-col gap-3">
          <span className="label-caps text-ink-muted">Multiple-Upload · {rows.length} photos</span>
          <h1 className="m-0 font-serif text-verdict-md font-bold text-ink-strong sm:text-verdict-lg">
            {rows.length} photos, one at a time
          </h1>
          <p className="m-0 max-w-3xl text-body-md text-ink-muted">
            There is one graphics card and VeraLens takes one analysis at a time, so this upload is a
            queue rather than a speed-up. What it buys you is not having to sit here between photos.
          </p>
        </div>

        <Progress
          stage={stage}
          rows={rows}
          toRun={toRun}
          runningElapsed={runningElapsed}
          onStart={onStart}
          onStop={onStop}
          onResume={onResume}
          onRetryFailed={onRetryFailed}
          onLeave={onLeave}
        />

        {notAdded.length > 0 && (
          <p className="m-0 rounded-lg bg-container-high px-4 py-3 text-body-sm text-ink-muted">
            {notAdded.length} not added — the limit is 20:{' '}
            <span className="font-mono">{notAdded.map((f) => f.name).join(', ')}</span>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3">
            <Count label="Read as real" value={c.real} />
            <Count label="Read as fake" value={c.fake} />
            <Count label="No face found" value={c.noFace} />
            <Count label="Still queued" value={c.queued} />
            {c.rejected > 0 && <Count label="Not accepted" value={c.rejected} />}
            {c.failed > 0 && <Count label="Failed" value={c.failed} />}
            {c.stopped > 0 && <Count label="Stopped" value={c.stopped} />}
          </dl>
          <Button
            variant="secondary"
            onClick={() => exportCsv(rows)}
            disabled={c.done === 0}
            className="px-5 py-2.5 text-body-sm"
          >
            <Icon name="download" size={18} />
            Export CSV
          </Button>
        </div>
        <p className="m-0 text-body-sm text-outline">
          These count verdicts on these photos. They are not an accuracy figure — VeraLens has only
          been measured on its own dataset, and the reasoning layer samples.
        </p>
      </section>

      <Table rows={rows} stage={stage} technical={technical} runningElapsed={runningElapsed} onOpen={onOpen} />

      <p className="m-0 max-w-3xl text-body-sm text-ink-muted">
        A row that says no face found is not a verdict of Real — it means the pipeline never ran.
        Keeping those visible in the table, rather than dropping them, is the difference between
        eight results and four.
      </p>
    </Page>
  )
}

function Progress({ stage, rows, toRun, runningElapsed, onStart, onStop, onResume, onRetryFailed, onLeave }) {
  const c = counts(rows)

  if (stage === 'ready') {
    const range = expectedRange(toRun)
    return (
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={onStart} disabled={toRun === 0}>
          <Icon name="play_arrow" size={20} />
          Start
        </Button>
        <span className="text-body-md text-ink">
          {toRun === 0 ? (
            'None of these photos can be sent.'
          ) : (
            <>
              <span className="font-semibold">{toRun} photos</span> · {range}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onLeave}
          className="cursor-pointer border-none bg-transparent p-0 text-body-sm text-ink-muted underline hover:text-terracotta-ink"
        >
          Choose different photos
        </button>
      </div>
    )
  }

  if (stage === 'paused') return <Paused done={c.done} onResume={onResume} onStop={onStop} />

  if (stage === 'running' || stage === 'stopping') {
    const eta = etaSeconds(rows, runningElapsed)
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sage-tint px-5 py-4">
        <div className="flex items-start gap-3">
          <Icon name="hourglass_top" className="vl-blink mt-0.5 text-sage-ink" size={20} />
          <p className="m-0 text-body-sm text-sage-ink">
            {stage === 'stopping' ? (
              'Stopping after the photo in progress — the graphics card finishes it either way, and its result is kept.'
            ) : (
              <>
                <span className="font-semibold">
                  {c.done + c.noFace + c.failed} of {rows.length - c.rejected} done
                </span>
                {rows.some((r) => r.status === 'running') && ' · 1 running'}
                {eta !== null && ` · about ${Math.max(1, Math.round(eta / 60))} min left`}
              </>
            )}
          </p>
        </div>
        {stage === 'running' && (
          <button
            type="button"
            onClick={onStop}
            className="label-caps cursor-pointer rounded-lg border border-sage-deep bg-transparent px-4 py-2 text-sage-ink hover:bg-sage-tint"
          >
            Stop
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <p className="m-0 text-body-md text-ink">
        {c.stopped > 0 ? 'Stopped.' : 'Finished.'} {c.done} of {rows.length} photos produced a verdict.
      </p>
      {c.failed > 0 && (
        <Button variant="secondary" onClick={onRetryFailed} className="px-5 py-2.5 text-body-sm">
          <Icon name="refresh" size={18} />
          {c.failed === 1 ? 'Try the failed photo again' : `Try the ${c.failed} failed photos again`}
        </Button>
      )}
    </div>
  )
}

/** The server went away mid-batch. Resume is offered only once /health
 *  answers again — a button that fails twenty rows is worse than none. */
function Paused({ done, onResume, onStop }) {
  const [reachable, setReachable] = useState(false)

  useEffect(() => {
    let live = true
    const check = () => ping().then((ok) => live && setReachable(ok))
    check()
    const timer = setInterval(check, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-terracotta-tint px-5 py-4">
      <div className="flex items-start gap-3">
        <Icon name="cloud_off" className="mt-0.5 flex-shrink-0 text-terracotta-ink" size={22} />
        <p className="m-0 text-body-sm text-terracotta-deep">
          VeraLens lost the analysis server, so this upload is paused rather than failing every photo
          left.{' '}
          {done === 0
            ? 'Nothing had finished yet.'
            : `The ${done} ${done === 1 ? 'result' : 'results'} already finished ${done === 1 ? 'is' : 'are'} kept.`}{' '}
          {reachable
            ? 'The server is answering again.'
            : 'Checking every few seconds for it to come back.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onResume} disabled={!reachable} className="px-6 py-2.5 text-body-sm">
          <Icon name="play_arrow" size={18} />
          Resume
        </Button>
        <Button variant="secondary" onClick={onStop} className="px-6 py-2.5 text-body-sm">
          Stop here
        </Button>
      </div>
    </div>
  )
}

function Count({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps text-ink-muted">{label}</dt>
      <dd className="m-0 font-mono text-data-lg font-bold text-ink-strong">{value}</dd>
    </div>
  )
}

/**
 * One markup, two layouts. From `lg` up it is a table; below that each row
 * becomes a card — file name, then status, then the numbers with their own
 * labels — because seven columns on a phone left the file name three
 * characters wide, and a tablet in the Technical register
 * was not much better. A second, card-only copy of the rows would have meant two
 * of every row in the document for anything that reads it without CSS.
 */
function Table({ rows, stage, technical, runningElapsed, onOpen }) {
  const queuedRows = rows.filter((r) => r.status === 'queued')
  const runningNow = rows.some((r) => r.status === 'running')

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-ambient">
      <table className="block w-full border-collapse text-left lg:table">
        <thead className="hidden lg:table-header-group">
          <tr className="bg-container">
            <Th>#</Th>
            <Th>File</Th>
            <Th>Status</Th>
            <Th right>Fake Probability</Th>
            {technical && <Th right>Classifier</Th>}
            <Th>Verdict</Th>
            <Th right>Time</Th>
          </tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {rows.map((row, index) => {
            const face = faceLabel(row)
            const position = queuedRows.indexOf(row) + (runningNow ? 2 : 1)
            return (
              <tr
                key={row.id}
                className="grid grid-cols-3 gap-x-4 gap-y-2 border-line p-4 sm:grid-cols-4 align-top not-first:border-t lg:table-row lg:border-t lg:p-0"
              >
                <td className="hidden px-4 py-3 font-mono text-data-mono text-ink-muted lg:table-cell">
                  {index + 1}
                </td>
                <td className="col-span-3 sm:col-span-4 lg:max-w-[320px] lg:px-4 lg:py-3">
                  <span className="mr-2 font-mono text-data-mono text-ink-muted lg:hidden">{index + 1}.</span>
                  {row.status === 'done' ? (
                    <button
                      type="button"
                      onClick={() => onOpen(row.id)}
                      className="cursor-pointer break-all border-none bg-transparent p-0 text-left font-mono text-data-mono font-medium text-sage-ink underline hover:text-terracotta-ink"
                    >
                      {row.file.name}
                    </button>
                  ) : (
                    <span className="break-all font-mono text-data-mono text-ink">{row.file.name}</span>
                  )}
                  {face && <div className="mt-1 text-body-sm text-ink-muted">{face}</div>}
                  {row.reason && <div className="mt-1 text-body-sm text-ink-muted">{row.reason}</div>}
                  {row.rerunError && (
                    <div className="mt-1 text-body-sm text-ink-muted">
                      Re-run failed, so this is still the earlier result: {row.rerunError}
                    </div>
                  )}
                </td>
                <td className="col-span-3 sm:col-span-4 text-body-sm text-ink lg:px-4 lg:py-3 lg:whitespace-nowrap">
                  <Status row={row} stage={stage} position={position} runningElapsed={runningElapsed} />
                </td>
                <Td label="Fake Probability" right className="font-mono text-data-mono text-ink-strong">
                  {display.probability(row)}
                </Td>
                {technical && (
                  <Td label="Classifier" right className="font-mono text-data-mono text-ink-strong">
                    {display.classifier(row)}
                  </Td>
                )}
                <Td label="Verdict" className="text-body-sm text-ink-strong">
                  {display.verdict(row)}
                </Td>
                <Td label="Time" right className="font-mono text-data-mono whitespace-nowrap text-ink-muted">
                  {row.status === 'done' ? formatElapsed(row.result.elapsed_seconds) : '—'}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A number cell. On a card it carries its column name, which the hidden
 *  table header no longer supplies. */
function Td({ label, right = false, className = '', children }) {
  return (
    <td className={`flex flex-col justify-end lg:table-cell lg:px-4 lg:py-3 ${right ? 'lg:text-right' : ''} ${className}`}>
      <span className="label-caps mb-0.5 block text-ink-muted lg:hidden">{label}</span>
      <span>{children}</span>
    </td>
  )
}

function Status({ row, stage, position, runningElapsed }) {
  switch (row.status) {
    case 'waiting':
      return stage === 'ready' ? 'Not started' : 'Checking for a face'
    case 'queued':
      return `Queued · ${ordinal(position)}`
    case 'running':
      // A clock, never a stage name: /analyze answers once, at the end, so
      // which model is working is not something the page can know.
      return <span className="font-semibold">Running · {formatClock(runningElapsed)}</span>
    case 'done':
      return row.rerun ? 'Done · re-run' : 'Done'
    case 'no_face':
      return 'No face found'
    case 'rejected':
      return 'Not accepted'
    case 'failed':
      return 'Failed'
    case 'stopped':
      return 'Stopped'
    default:
      return row.status
  }
}

function Th({ children, right = false }) {
  return (
    <th scope="col" className={`label-caps px-4 py-3 text-ink-muted ${right ? 'text-right' : ''}`}>
      {children}
    </th>
  )
}

function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'
  return `${n}${suffix}`
}

function exportCsv(rows) {
  const now = new Date()
  const blob = new Blob([toCsv(rows, now)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `veralens-batch-${now.toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
