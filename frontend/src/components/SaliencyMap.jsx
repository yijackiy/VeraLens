import { useState } from 'react'

import { asset } from '../api/client'

/**
 * The Saliency Map, with the submitted photo underneath it.
 *
 * The photo used to appear on hover only, which a phone cannot do — on touch
 * the caption promised something the screen would never show. A mouse still
 * peeks by hovering; a tap (or a click, or Enter) pins the photo until the
 * next one. Only a mouse peeks: a touch fires pointerenter too, so a finger
 * landing on the map to scroll the page would flash the photo up.
 */
export function SaliencyMap({ heatmapUrl, photoUrl, heatmapAlt, photoAlt, fake, className = '' }) {
  const [pinned, setPinned] = useState(false)
  const [hovering, setHovering] = useState(false)
  const showPhoto = Boolean(photoUrl) && (pinned || hovering)
  const onMouse = (value) => (event) => event.pointerType === 'mouse' && setHovering(value)

  const content = (
    <>
      <img src={asset(heatmapUrl)} alt={heatmapAlt} className="h-full w-full object-contain" />
      {photoUrl && (
        <img
          src={photoUrl}
          alt={photoAlt}
          className={`absolute inset-0 h-full w-full bg-slate object-contain transition-opacity duration-300 ${
            showPhoto ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      <span className="glass absolute right-3 bottom-3 flex items-center gap-2 rounded-lg px-3 py-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${fake ? 'bg-terracotta' : 'bg-sage'}`} />
        <span className="label-caps tracking-[0.12em] text-ink-strong">
          {showPhoto ? 'Your photo' : 'Saliency Map'}
        </span>
      </span>
    </>
  )

  const box = `relative block w-full overflow-hidden border border-line bg-slate p-0 ${className}`
  if (!photoUrl) return <div className={box}>{content}</div>

  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? 'Your original photo. Show the saliency map' : 'Saliency map. Show your original photo'}
      onClick={() => setPinned((value) => !value)}
      onPointerEnter={onMouse(true)}
      onPointerLeave={onMouse(false)}
      className={`${box} cursor-pointer`}
    >
      {content}
    </button>
  )
}
