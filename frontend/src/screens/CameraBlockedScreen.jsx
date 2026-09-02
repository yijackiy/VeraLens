import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { Sidebar, CAMERA_GUIDANCE } from '../components/Sidebar'

/** Screen 9 — one layout, three causes. Only the sentence under the heading
 *  and the recovery steps change. */
const REASONS = {
  refused: {
    body: 'Your browser blocked VeraLens from using the camera, so there is nothing to capture. This is a browser setting, not something VeraLens can change on its own.',
    steps: [
      "Click the camera icon in your browser's address bar and choose to allow access.",
      'Reload the page, then press “Use camera” again.',
    ],
  },
  'no-camera': {
    body: "This computer doesn't appear to have a camera VeraLens can use.",
    steps: [
      'Connect a webcam, or close whatever other application is holding the one you have.',
      'Reload the page, then press “Use camera” again.',
    ],
  },
  insecure: {
    body: 'The camera only works when VeraLens is open on this computer (localhost) or over a secure https address.',
    steps: [
      'Open VeraLens at http://localhost instead of an IP address or tunnel URL.',
      'Or serve it over https, which browsers accept from any host.',
    ],
  },
  failed: {
    body: 'The camera could not be started. Another application may be using it.',
    steps: [
      'Close any other application that might be holding the camera.',
      'Reload the page, then press “Use camera” again.',
    ],
  },
}

export function CameraBlockedScreen({ reason, onChooseFile, onRetry, onHowItWorks }) {
  const { body, steps } = REASONS[reason] ?? REASONS.failed

  return (
    <Page onHome={onChooseFile} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Sidebar guidance={CAMERA_GUIDANCE} onHowItWorks={onHowItWorks} />

        <section className="flex flex-grow flex-col gap-6">
          <div className="flex flex-col items-center rounded-3xl border border-line bg-paper px-8 py-16 text-center shadow-ambient">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-container-high">
              <Icon name="no_photography" className="text-ink-muted" size={40} />
            </div>

            <h1 className="m-0 mt-6 font-serif text-verdict-md font-semibold text-ink-strong">
              Camera unavailable
            </h1>
            <p className="m-0 mt-4 max-w-[560px] text-body-md text-ink-muted">{body}</p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Button onClick={onChooseFile}>Choose a file instead</Button>
              <Button variant="secondary" onClick={onRetry} className="px-6">
                Try the camera again
              </Button>
            </div>

            <p className="m-0 mt-5 text-body-sm text-outline">
              Choosing a file works exactly the same way and is not affected by this.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-paper p-6 shadow-ambient">
            <h2 className="label-caps m-0 mb-4 text-outline">To allow it</h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="label-caps mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sage-tint text-sage-deep">
                    {index + 1}
                  </span>
                  <span className="text-body-sm text-ink-muted">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </Page>
  )
}
