import { useEffect, useRef, useState } from 'react'

import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { percent } from '../lib/analysis'

// Below this, the classifier is reading a face stretched up to 224px rather
// than shrunk down to it — the case it was measured on. Matches the note
// UploadScreen and CameraReviewScreen already give about photo quality.
const SMALL_FACE_PX = 150

/**
 * Screen — between detection and classification.
 *
 * Reached only when /detect found more than one face: with one, VeraLens
 * analyses it without asking, the way it always has. Nothing here has been
 * classified yet, which is what makes choosing possible rather than a
 * re-run — the picker sits before the slow half of the pipeline, not after.
 */
export function FacePickerScreen({ previewUrl, faces, onChoose, onCancel, onHowItWorks }) {
  const [naturalSize, setNaturalSize] = useState(null)
  const largestArea = Math.max(...faces.map((f) => f.width * f.height))

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
          <span className="label-caps text-ink-muted">Before anything is classified</span>
          <h1 className="m-0 font-serif text-verdict-md font-semibold text-ink-strong">
            {faces.length} faces here. Which one?
          </h1>
          <p className="m-0 max-w-2xl text-body-md text-ink-muted">
            InsightFace found {faces.length}. VeraLens analyses one face at a time, so pick the one
            you meant — the pipeline has not run on any of them yet.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr]">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-slate shadow-ambient">
            <img
              src={previewUrl}
              alt={`The submitted photo with ${faces.length} detected faces boxed and numbered`}
              className="block max-h-[560px] w-full object-contain"
              onLoad={(event) =>
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
            {naturalSize && (
              <svg
                viewBox={`0 0 ${naturalSize.width} ${naturalSize.height}`}
                preserveAspectRatio="xMidYMid meet"
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                {faces.map((face) => {
                  const isLargest = face.width * face.height === largestArea
                  const [x1, y1] = face.bbox
                  const strokeWidth = Math.max(2, naturalSize.width / 400)
                  return (
                    <g key={face.index}>
                      <rect
                        x={x1}
                        y={y1}
                        width={face.width}
                        height={face.height}
                        fill="none"
                        stroke={isLargest ? '#788c5d' : '#f9f7f2'}
                        strokeOpacity={isLargest ? 1 : 0.7}
                        strokeWidth={strokeWidth}
                        rx={4}
                      />
                      <rect
                        x={x1}
                        y={Math.max(0, y1 - naturalSize.height * 0.035)}
                        width={naturalSize.width * 0.045}
                        height={naturalSize.height * 0.035}
                        fill={isLargest ? '#788c5d' : '#f9f7f2'}
                        rx={3}
                      />
                      <text
                        x={x1 + (naturalSize.width * 0.045) / 2}
                        y={Math.max(0, y1 - naturalSize.height * 0.035) + naturalSize.height * 0.026}
                        textAnchor="middle"
                        fontSize={naturalSize.height * 0.024}
                        fontWeight="700"
                        fill={isLargest ? '#ffffff' : '#1b1c1c'}
                      >
                        {face.index + 1}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {faces.map((face) => (
              <FaceRow
                key={face.index}
                face={face}
                previewUrl={previewUrl}
                recommended={face.width * face.height === largestArea}
                onChoose={() => onChoose(face.index)}
              />
            ))}
          </div>
        </div>
      </div>
    </Page>
  )
}

function FaceRow({ face, previewUrl, recommended, onChoose }) {
  const small = face.width < SMALL_FACE_PX || face.height < SMALL_FACE_PX

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-paper p-3.5 shadow-ambient ${
        recommended ? 'border-2 border-sage' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`label-caps flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
            recommended ? 'bg-sage text-on-sage' : 'bg-container-high text-ink-muted'
          }`}
        >
          {face.index + 1}
        </span>

        <FaceThumbnail previewUrl={previewUrl} bbox={face.bbox} />

        <div className="flex min-w-0 flex-grow flex-col gap-0.5">
          <span className="text-body-md font-semibold text-ink-strong">
            {recommended ? 'Largest face' : `Face ${face.index + 1}`}
          </span>
          <span className="font-mono text-data-mono text-ink-muted">
            {face.width} × {face.height} · {percent(face.det_score, 0)} sure it's a face
          </span>
        </div>

        <Button
          variant={recommended ? 'primary' : 'secondary'}
          onClick={onChoose}
          className="flex-shrink-0 px-5 py-2.5 text-body-sm"
        >
          Analyse
        </Button>
      </div>

      {small && (
        <div className="flex items-start gap-3 rounded-lg bg-terracotta-tint px-4 py-3">
          <Icon name="warning" className="mt-0.5 flex-shrink-0 text-terracotta-ink" size={18} />
          <p className="m-0 text-body-sm text-terracotta-deep">
            This face is {Math.min(face.width, face.height)}px wide before it is stretched to 224².
            Below {SMALL_FACE_PX}px the classifier is reading upscaled pixels, not what it was
            measured on.
          </p>
        </div>
      )}
    </div>
  )
}

/** A 64×64 canvas crop of one detected face, drawn from the full photo already
 *  in the browser — the picker exists before anything is sent again, so no
 *  second request is worth making just for a thumbnail. */
function FaceThumbnail({ previewUrl, bbox }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      const [x1, y1, x2, y2] = bbox
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, x1, y1, x2 - x1, y2 - y1, 0, 0, canvas.width, canvas.height)
    }
    img.src = previewUrl
  }, [previewUrl, bbox])

  return (
    <canvas
      ref={canvasRef}
      width={56}
      height={56}
      className="h-14 w-14 flex-shrink-0 rounded-lg bg-slate object-cover"
    />
  )
}
