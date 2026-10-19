import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { formatClock } from '../lib/analysis'

/**
 * Screen 4 — the wait.
 *
 * /analyze blocks and answers once, so VeraLens cannot know which stage is
 * running. Stages are marked from typical timing and the screen says so: the
 * marker reads "Expected now", never "Active". Making these real needs an SSE
 * or polling endpoint on the backend.
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
 * without measuring one.
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

export function AnalyzingScreen({ fileName, elapsed, onCancel, onHowItWorks, queuedName }) {
  const currentIndex = STAGES.findIndex((stage) => elapsed < stage.endsAt)

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
            const done = index < currentIndex || currentIndex === -1
            const expected = index === currentIndex

            return (
              <div
                key={stage.title}
                className="relative flex items-start gap-4 overflow-hidden rounded-xl border border-outline-variant/20 bg-paper p-6 shadow-ambient"
              >
                {expected && <div className="absolute inset-y-0 left-0 w-1 bg-sage" />}

                <div
                  className={`mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                    done
                      ? 'bg-sage-tint'
                      : expected
                        ? 'vl-blink border-2 border-sage'
                        : 'border border-outline-variant'
                  }`}
                >
                  <Icon
                    name={done ? 'check' : stage.icon}
                    fill={done}
                    className={done || expected ? 'text-sage' : 'text-outline-variant'}
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
                        expected ? 'text-sage' : 'text-outline'
                      }`}
                    >
                      {expected ? 'Expected now' : stage.typical}
                    </span>
                  </div>
                  <p className="m-0 text-body-sm text-ink-muted">{stage.body}</p>
                </div>
              </div>
            )
          })}

          <p className="m-0 text-body-sm text-outline">
            Stages are marked by typical timing, not live progress — VeraLens sends one response
            when all four have finished.
          </p>
        </div>
      </div>
    </Page>
  )
}
