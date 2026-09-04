import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { Sidebar, FILE_GUIDANCE } from '../components/Sidebar'
import { useBackendStatus } from '../hooks/useBackendStatus'

/**
 * Screen 1 — the way in.
 *
 * The design also offered a "Sample photos" card. It is not built: the two
 * obvious candidates are dataset images, which are pre-cropped 256×256 faces
 * that InsightFace refuses to detect, so the card would hand people a
 * guaranteed "no face found".
 */
export function UploadScreen({ onFile, onUseCamera, onHowItWorks, rejection, held, onAbandonHeld }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const backend = useBackendStatus()

  const pick = (fileList) => {
    const file = fileList?.[0]
    if (file) onFile(file)
  }

  return (
    <Page onHome={() => inputRef.current?.click()} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Sidebar guidance={FILE_GUIDANCE} onHowItWorks={onHowItWorks} />

        <section className="flex flex-grow flex-col gap-6">
          {/* Without this the upload screen looks identical whether or not an
              Analysis is parked, and the second photo arrives as a surprise
              comparison. It also carries the only way out that keeps A. */}
          {held && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sage-tint px-5 py-4">
              <div className="flex items-start gap-3.5">
                <Icon name="compare" className="mt-0.5 text-sage-ink" size={22} />
                <p className="m-0 text-body-sm text-sage-ink">
                  <span className="font-semibold">{held.photo.file.name}</span> is held as photo A.
                  Whatever you choose next becomes photo B, and the two will be shown on one scale.
                </p>
              </div>
              <button
                type="button"
                onClick={onAbandonHeld}
                className="label-caps cursor-pointer rounded-lg border border-sage-deep bg-transparent px-4 py-2.5 text-sage-ink hover:bg-sage-tint"
              >
                Back to photo A
              </button>
            </div>
          )}

          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              pick(event.dataTransfer.files)
            }}
            className={`relative flex min-h-[420px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed p-8 text-center shadow-ambient transition-colors ${
              dragging ? 'border-sage bg-cream' : 'border-outline-variant bg-paper'
            }`}
          >
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-transparent to-tint opacity-50" />

            <div className="relative flex max-w-[448px] flex-col items-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-sage-tint shadow-sm">
                <Icon name="cloud_upload" className="text-sage-deep" size={40} />
              </div>

              <h1 className="m-0 mb-3 font-serif text-verdict-md font-semibold text-ink-strong">
                Check a face photo
              </h1>
              <p className="m-0 mb-8 px-4 text-body-md text-ink-muted">
                Drag a photograph here, or bring one in from your files. VeraLens will say whether
                the face was generated, and explain why it decided that.
              </p>

              <span className="inline-flex items-center justify-center rounded-lg bg-sage-deep px-8 py-3 text-body-md font-semibold text-on-sage shadow-sage">
                Select photo
              </span>

              <p className="label-caps m-0 mt-6 tracking-[0.12em] text-outline">
                Supports JPG, PNG · one face · max 10MB
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                pick(event.target.files)
                event.target.value = ''
              }}
            />
          </div>

          {rejection && (
            <div className="flex items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4">
              <Icon name="error_outline" className="mt-0.5 text-terracotta-ink" size={22} />
              <p className="m-0 text-body-sm text-terracotta-deep">{rejection}</p>
            </div>
          )}

          {backend.status === 'down' && (
            <div className="flex items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4">
              <Icon name="cloud_off" className="mt-0.5 text-terracotta-ink" size={22} />
              <div className="flex flex-col items-start gap-2">
                <p className="m-0 text-body-sm text-terracotta-deep">
                  The analysis server isn't answering, so nothing can be analysed yet. Start it from
                  the repository root:
                </p>
                <code className="rounded bg-paper/60 px-2 py-1 font-mono text-[12px] text-terracotta-deep">
                  {String.raw`..\venv\Scripts\python.exe -m uvicorn backend.app.api.main:app --port 8000`}
                </code>
                <button
                  type="button"
                  onClick={backend.check}
                  className="cursor-pointer border-none bg-transparent p-0 font-mono text-[12px] font-semibold text-terracotta-ink underline"
                >
                  Check again
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onUseCamera}
            className="flex cursor-pointer items-center gap-4 rounded-xl border border-line bg-paper p-6 text-left shadow-soft hover:border-outline-variant"
          >
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-container-high">
              <Icon name="photo_camera" className="text-ink-muted" />
            </div>
            <div>
              <h3 className="m-0 text-body-md font-semibold text-ink-strong">Use camera</h3>
              <p className="m-0 mt-0.5 text-body-sm text-ink-muted">Take one still photo</p>
            </div>
          </button>
        </section>
      </div>
    </Page>
  )
}
