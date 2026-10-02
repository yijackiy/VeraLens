/**
 * A Batch — several Submitted Photos queued and analysed one at a time
 * (CONTEXT.md, "Batch"). Pure and DOM-free: the queue's rules live here, and
 * hooks/useBatch.js only runs them.
 *
 * A Batch is a queue, not a measurement. Nothing in this file computes an
 * accuracy, and the CSV it writes says so in its first lines, because a CSV
 * travels without the page that explains it.
 */

import { percent, rejectionReason } from './analysis'

/** A choice, not a limit of anything: twenty photos is 24–33 minutes, about
 *  as long as anyone leaves a laptop running a demo, and the first Qwen load
 *  can still crash the backend — a bigger queue mostly buys a bigger thing to
 *  lose. Rejected files do not count toward it. */
export const MAX_BATCH = 20

/**
 * Mean seconds per photo across the 600 recorded runs in
 * results/ablation_records*.jsonl. The mean, not the median (60 s): a queue's
 * total is a *sum*, and a sum of long-tailed times centres on n × mean.
 * Remaining × median lands near the 10th percentile of real batch durations,
 * so nine batches in ten would overrun it.
 */
export const MEAN_SECONDS = 86

/** After this many photos finish, the ETA uses this batch's own average
 *  instead — these photos, on this machine, may not match the evaluation set. */
export const OWN_AVERAGE_AFTER = 3

/**
 * The 10th–90th percentile total duration, in seconds, of a batch of n
 * photos, by bootstrap: 20,000 resampled sums of n draws from the same 600
 * recorded runs (random.seed(0)). Shown before a batch starts. Regenerate
 * from those files rather than adjusting by feel.
 */
const RANGE_SECONDS = {
  1: [51, 169], 2: [107, 254], 3: [164, 362], 4: [227, 467], 5: [300, 565],
  6: [384, 657], 7: [452, 762], 8: [529, 855], 9: [611, 950], 10: [682, 1046],
  11: [763, 1141], 12: [841, 1235], 13: [916, 1328], 14: [995, 1424],
  15: [1074, 1520], 16: [1153, 1605], 17: [1236, 1701], 18: [1309, 1798],
  19: [1388, 1888], 20: [1467, 1980],
}

/** "usually 9–14 minutes" for n photos, or null for none. */
export function expectedRange(n) {
  const range = RANGE_SECONDS[Math.min(n, MAX_BATCH)]
  if (!range) return null
  const lo = Math.max(1, Math.round(range[0] / 60))
  const hi = Math.max(lo + 1, Math.round(range[1] / 60))
  return `usually ${lo}–${hi} minutes`
}

/**
 * Row statuses, in the order a photo moves through them:
 *   waiting  — accepted, not yet through /detect
 *   queued   — detected; has a token and a chosen face
 *   running  — /analyze in flight
 *   done     — has an Analysis
 * or stops at one of:
 *   rejected — never sent (wrong type, too large)
 *   no_face  — /detect found nothing; NOT a Verdict of REAL
 *   failed   — this photo's request failed
 *   stopped  — the Batch was stopped before it ran
 */
export const UNFINISHED = ['waiting', 'queued', 'running']

let nextId = 0

/**
 * Turn chosen files into rows, in the order chosen. Rejected files become
 * rows that say why and do not count toward the cap; accepted files past the
 * cap are returned separately so the page can list them, never drop them.
 */
export function admit(files) {
  const rows = []
  const notAdded = []
  let accepted = 0
  for (const file of files) {
    const reason = rejectionReason(file)
    if (reason) {
      rows.push({ id: ++nextId, file, status: 'rejected', reason })
    } else if (accepted < MAX_BATCH) {
      accepted += 1
      rows.push({ id: ++nextId, file, status: 'waiting' })
    } else {
      notAdded.push(file)
    }
  }
  return { rows, notAdded }
}

/** The rows that will actually run — what the ETA and range are about. */
export function runnable(rows) {
  return rows.filter((row) => UNFINISHED.includes(row.status))
}

export function isUnfinished(rows) {
  return rows.some((row) => UNFINISHED.includes(row.status))
}

export function counts(rows) {
  const by = (predicate) => rows.filter(predicate).length
  return {
    real: by((r) => r.status === 'done' && r.result.final_verdict !== 'fake'),
    fake: by((r) => r.status === 'done' && r.result.final_verdict === 'fake'),
    noFace: by((r) => r.status === 'no_face'),
    queued: by((r) => UNFINISHED.includes(r.status)),
    rejected: by((r) => r.status === 'rejected'),
    failed: by((r) => r.status === 'failed'),
    stopped: by((r) => r.status === 'stopped'),
    done: by((r) => r.status === 'done'),
  }
}

/**
 * Seconds left, or null when nothing is left to run.
 *
 * Remaining photos × the mean, switching to this batch's own average once
 * OWN_AVERAGE_AFTER photos have finished. The running photo counts as
 * whatever of the average it has not used up yet — never less than zero,
 * because a photo past the average is in the tail, not nearly done.
 */
export function etaSeconds(rows, runningElapsed = 0) {
  const left = runnable(rows)
  if (left.length === 0) return null

  const finished = rows
    .filter((r) => r.status === 'done' && typeof r.result.elapsed_seconds === 'number')
    .map((r) => r.result.elapsed_seconds)
  const average =
    finished.length >= OWN_AVERAGE_AFTER
      ? finished.reduce((a, b) => a + b, 0) / finished.length
      : MEAN_SECONDS

  const running = left.some((r) => r.status === 'running')
  const waiting = left.length - (running ? 1 : 0)
  return waiting * average + (running ? Math.max(0, average - runningElapsed) : 0)
}

/** "Face 2 of 4" when the photo had more than one face, else null. */
export function faceLabel(row) {
  const found = row.result?.faces_found ?? row.facesFound
  const index = row.result?.face_index ?? row.faceIndex
  if (!found || found <= 1 || index == null) return null
  return `Face ${index + 1} of ${found}`
}

/* ---------------------------------------------------------------- CSV --- */

const CSV_COLUMNS = [
  'index',
  'file',
  'status',
  'fake_probability',
  'verdict',
  'classifier_score',
  'explanation_available',
  'faces_found',
  'face_index',
  'elapsed_seconds',
  'rerun',
  'explanation',
]

/**
 * The CSV, framing first. CSV has no real comments — Excel shows these as
 * ordinary rows — which is accepted over losing the caveat: a file that
 * leaves the page has to carry its own warning.
 */
export function toCsv(rows, exportedAt = new Date()) {
  const header = [
    `# VeraLens batch export, ${exportedAt.toISOString()}`,
    '# These are verdicts on these photos, one each. They are not an accuracy measurement.',
    '# The classifier was validated on dataset images only; it has not been measured on camera photos.',
    '# The reasoning layer samples (ADR 0013): the same photo analysed again can give a different explanation and fake_probability.',
    '# fake_probability is fused (0.55 classifier + 0.45 reasoning layer); classifier_score is the classifier alone.',
    '# status no_face is not a verdict of real: the pipeline never ran on that photo.',
  ]

  const lines = rows.map((row, i) => {
    const r = row.status === 'done' ? row.result : null
    return [
      i + 1,
      row.file.name,
      row.status,
      r ? r.fake_probability.toFixed(4) : '',
      r ? r.final_verdict : '',
      r ? r.classifier_score.toFixed(4) : '',
      r ? String(r.explanation_available) : '',
      r ? r.faces_found : '',
      r ? r.face_index : '',
      r ? r.elapsed_seconds : '',
      row.rerun ? 'true' : 'false',
      r && r.explanation_available ? r.explanation : '',
    ]
      .map(cell)
      .join(',')
  })

  return [...header, CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n'
}

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break. A text
 * cell starting with = + - @ or a tab is prefixed with an apostrophe:
 * spreadsheet software runs those as formulas, and a file name or a model's
 * sentence is not something to execute on whoever opens the export.
 */
function cell(value) {
  let text = String(value ?? '')
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Display helpers the table and the CSV agree on. */
export const display = {
  probability: (row) => (row.status === 'done' ? percent(row.result.fake_probability) : '—'),
  classifier: (row) => (row.status === 'done' ? percent(row.result.classifier_score) : '—'),
  verdict: (row) =>
    row.status === 'done' ? (row.result.final_verdict === 'fake' ? 'Fake' : 'Real') : '—',
}
