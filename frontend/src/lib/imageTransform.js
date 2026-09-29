/**
 * The bounding box of a width×height rectangle after rotating it about its
 * own center by rotationDegrees — the canvas size needed so the rotated
 * photo isn't clipped. Pure, so it's testable without a canvas.
 */
export function rotatedBounds(width, height, rotationDegrees) {
  const radians = (rotationDegrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}

/**
 * Rotates a photo about its center and crops it to a centered rectangle,
 * matching what CropScreen previews. Returns a new File (same MIME type,
 * same name) so the rest of the pipeline — object URLs, /detect — never
 * knows the photo was touched.
 *
 * The crop frame is fixed, not draggable: it always keeps the centered
 * frameWidthFraction × frameHeightFraction of the rotated photo. That turns
 * "small face in a big frame" into a bigger fraction of a smaller frame,
 * without building a drag-and-resize crop tool for a feature that was cut
 * from scope once already (see the mockup canvas note on Crop.dc.html).
 */
export async function rotateAndCrop(
  file,
  { rotationDegrees, frameWidthFraction = 0.78, frameHeightFraction = 0.82 } = {},
) {
  const bitmap = await createImageBitmap(file)
  try {
    const radians = (rotationDegrees * Math.PI) / 180
    const rotated = rotatedBounds(bitmap.width, bitmap.height, rotationDegrees)

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rotated.width * frameWidthFraction))
    canvas.height = Math.max(1, Math.round(rotated.height * frameHeightFraction))
    const ctx = canvas.getContext('2d')
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(radians)
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, file.type || 'image/jpeg', 0.92),
    )
    return new File([blob], file.name, { type: file.type || 'image/jpeg' })
  } finally {
    bitmap.close?.()
  }
}
