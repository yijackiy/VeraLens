import { useEffect, useRef } from 'react'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { Sidebar, CAMERA_GUIDANCE } from '../components/Sidebar'

/** Screen 2 — live preview. One still frame is captured from it; the video
 *  itself is never recorded, never uploaded, and never leaves the page. */
export function CameraScreen({ stream, onCapture, onCancel, onHowItWorks }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (video && stream) video.srcObject = stream
  }, [stream])

  return (
    <Page onHome={onCancel} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Sidebar guidance={CAMERA_GUIDANCE} onHowItWorks={onHowItWorks} />

        <section className="flex flex-grow flex-col gap-6">
          <div className="overflow-hidden rounded-3xl border border-line bg-paper p-4 shadow-ambient sm:p-6">
            <div className="relative overflow-hidden rounded-2xl bg-slate">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="block h-[360px] w-full bg-slate object-cover sm:h-[420px]"
              />
              {/* Framing guide — the detector wants one face, front on, large in frame. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[240px] w-[180px] rounded-[50%] sm:h-[300px] sm:w-[230px] border-2 border-dashed border-white/60" />
              </div>
              <div className="glass absolute bottom-4 left-4 flex items-center gap-2 rounded-lg px-3 py-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-sage" />
                <span className="label-caps tracking-[0.12em] text-ink-strong">Not recording</span>
              </div>
            </div>

            <div className="px-2 pt-6 pb-2">
              <h1 className="m-0 font-serif text-verdict-md font-semibold text-ink-strong">
                Take a photo
              </h1>
              <p className="m-0 mt-3 text-body-md text-ink-muted">
                Line one face up inside the outline: front‑facing, evenly lit, filling most of the
                frame. VeraLens analyses a single still photo, never the video.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button onClick={() => onCapture(videoRef.current)}>
                  <Icon name="photo_camera" size={20} />
                  Take photo
                </Button>
                <Button variant="secondary" onClick={onCancel} className="px-6">
                  Cancel
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-xl bg-sage-tint px-6 py-5">
            <Icon name="verified_user" className="mt-0.5 text-sage-deep" size={22} />
            <p className="m-0 text-body-sm text-ink-muted">
              You get to look at the photo before anything is analysed. Nothing leaves this page
              until you confirm it.
            </p>
          </div>
        </section>
      </div>
    </Page>
  )
}
