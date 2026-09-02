import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { Sidebar, CAMERA_GUIDANCE } from '../components/Sidebar'

/** Screen 3 — the pause before a 60-90 second wait. */
export function CameraReviewScreen({
  previewUrl,
  capturedAt,
  onAnalyse,
  onRetake,
  onChooseFile,
  onHowItWorks,
}) {
  return (
    <Page onHome={onChooseFile} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Sidebar guidance={CAMERA_GUIDANCE} onHowItWorks={onHowItWorks} />

        <section className="flex flex-grow flex-col gap-6">
          <div className="overflow-hidden rounded-3xl border border-line bg-paper p-6 shadow-ambient">
            <div className="overflow-hidden rounded-2xl bg-slate">
              <img
                src={previewUrl}
                alt="The photo you just captured, waiting for you to confirm it"
                className="block h-[420px] w-full object-contain"
              />
            </div>

            <div className="px-2 pt-6 pb-2">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="m-0 font-serif text-verdict-md font-semibold text-ink-strong">
                  Use this photo?
                </h1>
                <span className="font-mono text-[12px] font-medium text-outline">
                  Captured {capturedAt}
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button onClick={onAnalyse}>Analyse this photo</Button>
                <Button variant="secondary" onClick={onRetake} className="px-6">
                  <Icon name="photo_camera" size={20} />
                  Retake
                </Button>
                <button
                  type="button"
                  onClick={onChooseFile}
                  className="cursor-pointer rounded-lg border-none bg-transparent px-4 py-3 text-body-md font-semibold text-ink-muted hover:text-terracotta"
                >
                  Choose a file instead
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-xl bg-container px-6 py-5">
            <Icon name="schedule" className="mt-0.5 text-terracotta" size={22} />
            <p className="m-0 text-body-sm text-ink-muted">
              Analysis takes <strong className="font-semibold">60–90 seconds</strong> and can't be
              sped up, so it is worth a look first: is the face sharp, front‑facing, and free of
              heavy shadow? A blurred or half‑turned face is the usual reason the face detector
              finds nothing.
            </p>
          </div>
        </section>
      </div>
    </Page>
  )
}
