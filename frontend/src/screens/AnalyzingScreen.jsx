import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { formatClock } from '../lib/analysis'
import { describeProgress, STEP_COUNT } from '../lib/progress'

/**
 * Screen 4 — the wait.
 *
 * The backend reports which step an Analysis is on while /analyze is still
 * blocking (backend/app/progress.py, asked for by hooks/useProgress). When it
 * has said something, the steps below are marked from that. Until it has — the
 * first second, or a backend without the endpoint — they are marked from
 * typical timing and the screen says so, never "running now".
 *
 * The bar is made of steps, not of a percentage, and that is deliberate (ADR
 * 0015). The last step is nearly all of the wait and has no length: the model
 * stops when it has finished writing, not at a count. A bar that filled with
 * time would be full while the work was still going on a third of the time, and
 * one that filled with tokens would stall at an arbitrary point and jump. What
 * is known is how many steps are done and which one is running, so that is all
 * it shows; the step with no length gets a counter instead.
 *
 * Every duration here comes from the 600 recorded runs in
 * results/ablation_records.jsonl and results/ablation_records_informed.jsonl
 * (the `seconds` field), on this hardware. Re-derive them rather than
 * adjusting by feel:
 *
 *   floor 40s · median 60s · p75 116s · p90 169s · p99 200s
 *   48% exceed 60s · 36% exceed 90s · 20% exceed 120s · 5% exceed 180s
 *
 * The screen used to promise "between 60 and 90 seconds", which named the
 * median as the floor and a figure a third of runs pass as the ceiling. The
 * distribution is long-tailed, not a range, so the copy gives the middle and
 * the tail separately — someone two minutes into a wait needs to know that is
 * normal, not that the page is stuck.
 *
 * What drives the spread is not known. It is not explanation length:
 * corr(seconds, explanation characters) = -0.37 across those runs, i.e. the
 * slow runs write *shorter* answers. Do not write a cause into this copy
 * without measuring one. (A retry or a cold model load are causes the screen
 * can now *see* happening, and says so when they do; neither is claimed to be
 * the usual one.)
 */
const STAGES = [
  {
    title: 'Face detection',
    typical: '~1 sec',
    endsAt: 1,
    icon: 'crop_free',
    body: 'InsightFace finds the face and cuts the 224×224 crop the classifier will see.',
  },
  {
    title: 'Fake Probability',
    typical: '~1 sec',
    endsAt: 2,
    icon: 'speed',
    body: 'EfficientNet‑B4 scores how likely the crop is to be fake, from 0% to 100%.',
  },
  {
    title: 'Saliency Map',
    typical: '~2 sec',
    endsAt: 4,
    icon: 'blur_on',
    body: 'Grad‑CAM traces which regions of the face moved that number.',
  },
  {
    title: 'Writing the explanation',
    // The whole distribution above, less the ~4 seconds the three stages
    // before it take: 36s at the floor, ~165s at p90.
    typical: '40 sec – 3 min',
    endsAt: Infinity,
    icon: 'auto_awesome',
    body: 'Qwen3‑VL‑2B reads the crop and the verdict, then writes a few sentences.',
  },
]

export function AnalyzingScreen({
  fileName,
  elapsed,
  onCancel,
  onHowItWorks,
  queuedName,
  progress = null,
}) {
  const info = describeProgress(progress)

  // Which step is running, and which are done. From the server when it has
  // said; from typical timing when it has not.
  const timedIndex = STAGES.findIndex((stage) => elapsed < stage.endsAt)
  const activeIndex = info.known ? info.active : timedIndex === -1 ? null : timedIndex
  const doneCount = info.known ? info.completed : Math.max(0, timedIndex === -1 ? STEP_COUNT : timedIndex)

  return (
    <Page width="narrow" onHelp={onHowItWorks}>
      <div className="flex flex-grow flex-col items-center justify-center gap-16 py-12 lg:flex-row lg:gap-24">
        <div className="flex w-full flex-col lg:w-[400px] lg:flex-shrink-0">
          <h1 className="m-0 mb-6 font-serif text-verdict-md font-bold text-ink-strong sm:text-verdict-lg">
            Looking at the photo
          </h1>
          <p className="m-0 mb-6 text-body-md text-ink-muted">
            Four models run one after another on a single consumer graphics card. Half of all
            analyses finish inside a minute, but the spread is wide: about a third run past 90
            seconds, and one in ten takes closer to three. Almost all of that is the last step.
          </p>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="label-caps rounded-full bg-sage-tint px-4 py-1.5 text-sage-deep">
              Elapsed {formatClock(elapsed)}
            </span>
            <span className="break-all font-mono text-data-mono font-medium text-outline">{fileName}</span>
          </div>

          <StepBar
            known={info.known}
            doneCount={doneCount}
            activeIndex={activeIndex}
            waiting={info.waiting}
          />

          {/* Without this a two-photo run looks exactly like a one-photo run,
              and the second wait arrives as a surprise. They queue rather than
              overlap — there is one graphics card. */}
          {queuedName && (
            <div className="mb-4 flex items-start gap-3.5 rounded-xl bg-sage-tint px-5 py-4">
              <Icon name="compare" className="mt-0.5 text-sage-ink" size={22} />
              <p className="m-0 text-body-sm text-sage-ink">
                This is photo A.{' '}
                <span className="font-semibold">{queuedName}</span> is queued behind it and starts
                once this one finishes — you will see this verdict while it runs.
              </p>
            </div>
          )}

          {/* The other kind of waiting: this photo's own turn. The graphics
              card takes one analysis at a time, and a second request sits here
              — with the clock running — until the first is done. */}
          {info.waiting && (
            <div className="mb-4 flex items-start gap-3.5 rounded-xl bg-container-high px-5 py-4">
              <Icon name="hourglass_top" className="mt-0.5 text-ink-muted" size={22} />
              <p className="m-0 text-body-sm text-ink-muted">
                Waiting for the graphics card. Another analysis is still running, and this one
                starts the moment it finishes — the clock above includes this wait.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer self-start rounded-lg border border-outline bg-transparent px-5 py-2.5 text-body-sm font-semibold text-ink hover:bg-container-high"
          >
            Stop waiting
          </button>
          <p className="m-0 mt-2 text-body-sm text-outline">
            The graphics card finishes this analysis either way — stopping only closes the page on
            it.
          </p>

          <div className="vl-float relative mt-12 flex h-48 w-48 items-center justify-center">
            <div className="vl-pulse absolute inset-0 rounded-full bg-sage-tint blur-2xl" />
            <div
              className="vl-pulse absolute inset-4 rounded-full bg-sage opacity-20"
              style={{ animationDelay: '1s' }}
            />
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-paper shadow-ambient">
              <Icon name="autorenew" className="vl-spin text-sage" size={36} />
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-6 lg:w-[400px] lg:flex-shrink-0">
          {STAGES.map((stage, index) => {
            const done = index < doneCount
            const running = index === activeIndex

            return (
              <div
                key={stage.title}
                className="relative flex items-start gap-4 overflow-hidden rounded-xl border border-outline-variant/20 bg-paper p-6 shadow-ambient"
              >
                {running && <div className="absolute inset-y-0 left-0 w-1 bg-sage" />}

                <div
                  className={`mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                    done
                      ? 'bg-sage-tint'
                      : running
                        ? 'vl-blink border-2 border-sage'
                        : 'border border-outline-variant'
                  }`}
                >
                  <Icon
                    name={done ? 'check' : stage.icon}
                    fill={done}
                    className={done || running ? 'text-sage' : 'text-outline-variant'}
                    size={16}
                  />
                </div>

                <div className="flex-grow">
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <h3 className="m-0 text-headline-sm font-semibold text-ink-strong">
                      {stage.title}
                    </h3>
                    <span
                      className={`font-mono text-[12px] font-medium uppercase ${
                        running ? 'text-sage' : 'text-outline'
                      }`}
                    >
                      {running ? (info.known ? 'Running now' : 'Expected now') : stage.typical}
                    </span>
                  </div>
                  <p className="m-0 text-body-sm text-ink-muted">{stage.body}</p>

                  {running && index === STAGES.length - 1 && info.known && (
                    <WritingDetail info={info} />
                  )}
                </div>
              </div>
            )
          })}

          <p className="m-0 text-body-sm text-outline">
            {info.known
              ? 'Steps are reported by the server as they happen. The last one has no length to show — the model stops when it has finished writing — so VeraLens shows that it is still writing rather than guessing how much is left.'
              : 'Stages are marked by typical timing, not live progress — until the server says which step it is on.'}
          </p>
        </div>
      </div>
    </Page>
  )
}

/**
 * Four steps, done or running or not yet. No part of it is a measure of time
 * or of how much of the last step remains, and nothing in it ever reads 100%
 * before the response lands.
 */
function StepBar({ known, doneCount, activeIndex, waiting }) {
  const caption = !known
    ? 'Starting'
    : waiting
      ? 'Waiting for the graphics card'
      : `Step ${(activeIndex ?? doneCount) + 1} of ${STEP_COUNT} · ${STAGES[activeIndex ?? doneCount]?.title ?? ''}`

  return (
    <div className="mb-5">
      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={known ? doneCount : undefined}
        aria-valuetext={caption}
        className="flex gap-1.5"
      >
        {STAGES.map((stage, index) => {
          const done = index < doneCount
          const running = index === activeIndex
          return (
            <div
              key={stage.title}
              className={`h-2 flex-1 rounded-full ${
                done ? 'bg-sage' : running ? 'vl-sweep bg-sage/40' : known ? 'bg-line' : 'vl-blink bg-line'
              }`}
            />
          )
        })}
      </div>
      {/* Announced when the step changes; the token counter below is kept out
          of it so a screen reader is not read a number every few hundred
          milliseconds. */}
      <p aria-live="polite" className="label-caps m-0 mt-2.5 text-outline">
        {caption}
      </p>
    </div>
  )
}

function WritingDetail({ info }) {
  if (info.loading) {
    return (
      <p className="m-0 mt-3 text-body-sm text-ink-muted">
        Loading the reasoning model onto the graphics card. This happens on the first analysis
        after the server starts, and adds to its wait.
      </p>
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {typeof info.tokens === 'number' && (
        // A heartbeat, not a measurement. "Tokens" means nothing to most
        // readers and the count has no total to be a fraction of, so the
        // screen says what it is for: the model is writing, not stuck. The
        // number stays one hover away for anyone who wants it.
        <span
          aria-hidden="true"
          title={`${info.tokens} tokens written so far`}
          className="label-caps inline-flex items-center gap-2 self-start rounded bg-sage-tint px-2 py-1 text-sage-deep"
        >
          <span className="vl-blink inline-block h-1.5 w-1.5 rounded-full bg-sage" />
          Still writing — working, not stuck
        </span>
      )}
      {info.retrying && (
        <p className="m-0 text-body-sm text-ink-muted">
          The last reply wasn't in a form VeraLens could read, so the model is writing it again
          (attempt {info.attempt} of {info.maxAttempts}).
        </p>
      )}
    </div>
  )
}
