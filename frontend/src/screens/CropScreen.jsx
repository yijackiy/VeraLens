import { useState } from 'react'

import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'

const FRAME_WIDTH_FRACTION = 0.78
const FRAME_HEIGHT_FRACTION = 0.82

/**
 * Screen — before anything is sent.
 *
 * Reached only from the "Straighten first" card on the upload screen: this
 * is not the default path, and skipping it (never opening it at all) sends
 * the photo exactly as it is today. It is not about helping the classifier
 * see better — InsightFace re-crops to 224² whatever it is handed — it is
 * about the two things that make detection fail outright: a face lying
 * sideways, and a face too small in the frame to survive the crop.
 */
export function CropScreen({ previewUrl, onUse, onCancel, onHowItWorks }) {
  const [orientation, setOrientation] = useState(0) // 0 / 90 / 180 / 270, from the quick-rotate button
  const [fineRotation, setFineRotation] = useState(0) // -45..45, from the slider
  const [working, setWorking] = useState(false)
  const totalRotation = orientation + fineRotation

  const reset = () => {
    setOrientation(0)
    setFineRotation(0)
  }

  const useThisCrop = async () => {
    setWorking(true)
    try {
      await onUse({
        rotationDegrees: totalRotation,
        frameWidthFraction: FRAME_WIDTH_FRACTION,
        frameHeightFraction: FRAME_HEIGHT_FRACTION,
      })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Page width="wide" onHome={onCancel} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={onCancel}
          className="flex w-fit cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-ink-muted hover:text-terracotta-ink"
        >
          <Icon name="arrow_back" size={20} />
          <span className="label-caps">Choose a different photo</span>
        </button>

        <div className="flex flex-col gap-2">
          <span className="label-caps text-ink-muted">Nothing has been sent yet</span>
          <h1 className="m-0 font-serif text-verdict-md font-semibold text-ink-strong">
            Straighten it first
          </h1>
          <p className="m-0 max-w-3xl text-body-md text-ink-muted">
            This is not about helping the classifier see better — InsightFace re-crops to 224²
            whatever you hand it. It is about the two things that make detection fail outright: a
            face lying sideways, and a face too small in the frame to survive the crop.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="relative flex h-[360px] w-full items-center sm:h-[480px] justify-center overflow-hidden rounded-2xl border border-line bg-slate">
              <img
                src={previewUrl}
                alt="The submitted photo, rotated for preview"
                className="max-h-[82%] max-w-[82%] object-contain transition-transform duration-150"
                style={{ transform: `rotate(${totalRotation}deg)` }}
              />
              <CropFrameOverlay />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-paper px-5 py-4.5 shadow-ambient sm:flex-nowrap sm:px-6">
              <span className="label-caps flex-shrink-0 text-ink-muted">Rotate</span>
              <input
                type="range"
                min={-45}
                max={45}
                step={0.5}
                value={fineRotation}
                onChange={(event) => setFineRotation(Number(event.target.value))}
                className="order-last h-1.5 w-full cursor-pointer accent-sage-deep sm:order-none sm:w-auto sm:flex-grow"
                aria-label="Fine rotation, degrees"
              />
              <span className="font-mono text-data-mono font-bold text-ink-strong ml-auto w-[64px] flex-shrink-0 text-right sm:ml-0">
                {totalRotation.toFixed(1)}°
              </span>
              <button
                type="button"
                onClick={() => setOrientation((current) => (current + 90) % 360)}
                className="flex flex-shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-outline bg-transparent px-4.5 py-2.5 text-body-sm font-semibold text-ink hover:bg-container-high"
              >
                <Icon name="rotate_90_degrees_ccw" size={18} />
                90°
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-5 shadow-ambient">
              <div className="flex items-center gap-2.5 border-b border-line pb-3.5">
                <Icon name="crop" className="text-sage" size={22} />
                <h2 className="m-0 text-headline-sm font-semibold text-ink-strong">
                  What the crop gives the pipeline
                </h2>
              </div>
              <Row label="Kept from the photo" value={`${Math.round(FRAME_WIDTH_FRACTION * 100)}% × ${Math.round(FRAME_HEIGHT_FRACTION * 100)}%`} />
              <Row label="Centred, not draggable" value="fixed frame" last />
              <div className="flex items-start gap-3 rounded-lg bg-sage-tint px-4 py-3.5">
                <Icon name="check" className="mt-0.5 flex-shrink-0 text-sage-ink" size={18} />
                <p className="m-0 text-body-sm text-sage-ink">
                  A tighter frame turns a small face into a bigger fraction of it — closer to the
                  downscale-into-224 case the classifier was measured on, rather than an upscale.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-outline-variant/50 bg-container px-5 py-4">
              <div className="flex items-start gap-3">
                <Icon name="tips_and_updates" className="mt-0.5 flex-shrink-0 text-terracotta" size={20} />
                <p className="m-0 text-body-sm text-ink-muted">
                  Use the original photo where you can, with a front-facing face filling most of
                  the frame. Screenshots and re-saved images lose the fine detail the classifier
                  reads.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={reset} className="px-6">
                Reset
              </Button>
              <Button onClick={useThisCrop} disabled={working} className="flex-grow">
                <Icon name="check" size={20} />
                {working ? 'Preparing…' : 'Use this crop'}
              </Button>
            </div>

            <p className="m-0 text-body-sm text-ink-muted">
              Not entering this screen sends the photo exactly as it is today — the crop is
              optional, not a new requirement.
            </p>
          </div>
        </div>
      </div>
    </Page>
  )
}

/** The centred frame + rule-of-thirds grid + corner brackets. Purely visual —
 *  it marks the fixed region rotateAndCrop() actually keeps, drawn with a
 *  box-shadow spread as the mask so it stays cheap to redraw every slider tick. */
function CropFrameOverlay() {
  return (
    <div
      className="pointer-events-none absolute rounded"
      style={{
        width: `${FRAME_WIDTH_FRACTION * 100}%`,
        height: `${FRAME_HEIGHT_FRACTION * 100}%`,
        boxShadow: '0 0 0 9999px rgba(23, 22, 21, 0.55)',
        border: '2px solid rgba(249, 247, 242, 0.9)',
      }}
    >
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <div key={index} className="border border-paper/30" />
        ))}
      </div>
      {['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map(
        (position) => (
          <div
            key={position}
            className={`absolute h-4 w-4 border-paper ${position} ${
              position.includes('top') ? 'border-t-2' : 'border-b-2'
            } ${position.includes('left') ? 'border-l-2' : 'border-r-2'}`}
          />
        ),
      )}
    </div>
  )
}

function Row({ label, value, last = false }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 ${last ? '' : 'border-b border-line'}`}
    >
      <span className="text-body-sm text-ink-muted">{label}</span>
      <span className="font-mono text-data-mono font-medium text-ink-strong">{value}</span>
    </div>
  )
}
