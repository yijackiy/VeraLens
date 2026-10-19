import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { Sidebar, FILE_GUIDANCE, CAMERA_GUIDANCE } from '../components/Sidebar'

/**
 * Screen 8 — and the two failures the design never drew.
 *
 * All three share one load-bearing line: nothing was judged. A photo that
 * never produced a Face Crop, or an analysis that never came back, is not a
 * verdict of Real — it is the absence of a verdict, and the terracotta band
 * says so in every variant.
 */
const VARIANTS = {
  no_face: {
    icon: 'face_retouching_off',
    title: 'No face found',
    band: (
      <>
        Nothing was judged. This is <em>not</em> a verdict of Real — VeraLens never saw a face to
        form an opinion about.
      </>
    ),
    fixes: [
      'Use a photo where the face is front‑facing and fills a good part of the frame.',
      'Avoid heavy shadow, motion blur, sunglasses, or a face turned in profile.',
      'Crop to a single person — VeraLens analyses one face at a time.',
    ],
  },
  unreachable: {
    icon: 'cloud_off',
    title: "The analysis server didn't answer",
    band: (
      <>
        Nothing was judged. This is <em>not</em> a verdict of Real — the photo never reached a
        model.
      </>
    ),
    fixes: [
      'Check that the backend is running: uvicorn backend.app.api.main:app --port 8000.',
      'Give it a moment after startup — the first analysis also loads the models.',
      'Then press “Try this one again”; the photo is still here.',
    ],
  },
  server: {
    icon: 'error_outline',
    title: "The analysis didn't finish",
    band: (
      <>
        Nothing was judged. This is <em>not</em> a verdict of Real — the pipeline stopped part way
        through.
      </>
    ),
    fixes: [
      'The backend log will carry the traceback for this request.',
      'A GPU that is already busy, or out of memory, is the usual cause.',
      'Press “Try this one again” once it has recovered.',
    ],
  },
}

export function ProblemScreen({
  kind,
  fileName,
  detail,
  fromCamera,
  onChooseAnother,
  onRetry,
  onHowItWorks,
  held,
  onAbandonHeld,
}) {
  const variant = VARIANTS[kind] ?? VARIANTS.server

  return (
    <Page onHome={onChooseAnother} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Sidebar
          guidance={fromCamera ? CAMERA_GUIDANCE : FILE_GUIDANCE}
          onHowItWorks={onHowItWorks}
        />

        <section className="flex flex-grow flex-col gap-6">
          <div className="flex flex-col items-center rounded-3xl border border-line bg-paper px-8 py-16 text-center shadow-ambient">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-container-high">
              <Icon name={variant.icon} className="text-ink-muted" size={40} />
            </div>

            <h1 className="m-0 mt-6 font-serif text-verdict-md font-semibold text-ink-strong">
              {variant.title}
            </h1>

            <p className="m-0 mt-4 max-w-[560px] text-body-md text-ink-muted">
              {kind === 'no_face' ? (
                <>
                  The face detector didn't find a face in{' '}
                  <span className="rounded bg-container px-2 py-0.5 font-mono break-all text-data-mono text-ink-strong">
                    {fileName}
                  </span>
                  , so there was nothing to analyse.
                </>
              ) : (
                detail
              )}
            </p>

            <div className="mt-6 flex max-w-[560px] items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4 text-left">
              <Icon name="error_outline" className="mt-0.5 text-terracotta-ink" size={22} />
              <p className="m-0 text-[15px] leading-relaxed text-terracotta-deep">{variant.band}</p>
            </div>

            {/* Photo A cost someone 40 to 90 seconds. Losing it because the
                second photo had no face in it is the failure you least want
                in front of an audience, so the held Analysis is stated here
                and both ways forward keep it. */}
            {held && (
              <div className="mt-6 flex max-w-[560px] items-start gap-3.5 rounded-xl bg-sage-tint px-5 py-4 text-left">
                <Icon name="compare" className="mt-0.5 text-sage-ink" size={22} />
                <p className="m-0 text-body-sm text-sage-ink">
                  <span className="font-semibold break-all">{held.photo.file.name}</span> is still held as
                  photo A. Nothing that happened here touched it.
                </p>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Button onClick={onChooseAnother}>
                {held
                  ? 'Try a different second photo'
                  : fromCamera
                    ? 'Take another photo'
                    : 'Choose a different photo'}
              </Button>
              <Button variant="secondary" onClick={onRetry} className="px-6">
                Try this one again
              </Button>
              {held && (
                <Button variant="quiet" onClick={onAbandonHeld} className="px-6">
                  Back to photo A alone
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-paper p-6 shadow-ambient">
            <h2 className="label-caps m-0 mb-4 text-outline">
              {kind === 'no_face' ? 'What usually fixes it' : 'What to check'}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {variant.fixes.map((fix) => (
                <li key={fix} className="flex items-start gap-3">
                  <Icon name="check_circle" className="mt-0.5 flex-shrink-0 text-sage" size={20} />
                  <span className="text-body-sm text-ink-muted">{fix}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </Page>
  )
}
