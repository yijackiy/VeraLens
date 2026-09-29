import { describe, expect, it } from 'vitest'

import { rotatedBounds } from './imageTransform'

describe('rotatedBounds', () => {
  it('leaves the box unchanged at 0 degrees', () => {
    const box = rotatedBounds(400, 600, 0)
    expect(box.width).toBeCloseTo(400)
    expect(box.height).toBeCloseTo(600)
  })

  it('swaps width and height at 90 degrees', () => {
    const box = rotatedBounds(400, 600, 90)
    expect(box.width).toBeCloseTo(600)
    expect(box.height).toBeCloseTo(400)
  })

  it('is symmetric between +45 and -45 degrees', () => {
    const positive = rotatedBounds(400, 600, 45)
    const negative = rotatedBounds(400, 600, -45)
    expect(positive.width).toBeCloseTo(negative.width)
    expect(positive.height).toBeCloseTo(negative.height)
  })

  it('grows the bounding box for any rotation between the axis-aligned cases', () => {
    // A rotated rectangle's axis-aligned bounding box is never smaller than
    // the rectangle itself — this is the property CropScreen's canvas sizing
    // depends on to avoid clipping corners.
    const original = rotatedBounds(400, 600, 0)
    const rotated = rotatedBounds(400, 600, 20)
    expect(rotated.width).toBeGreaterThanOrEqual(original.width)
    expect(rotated.height).toBeGreaterThanOrEqual(original.height)
  })
})
