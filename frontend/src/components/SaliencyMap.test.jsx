/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SaliencyMap } from './SaliencyMap'

/**
 * The submitted photo sits under the Saliency Map. It used to appear on
 * hover only, which a phone cannot do. What matters: a tap shows it and a
 * second tap hides it; a finger that lands on the map without tapping (to
 * scroll, say) shows nothing; and a mouse still peeks by hovering.
 */

afterEach(cleanup)

const photo = () => screen.getByAltText('photo')
const shown = () => photo().className.includes('opacity-100')

function renderMap(props = {}) {
  render(
    <SaliencyMap heatmapUrl="/h.png" photoUrl="blob:p" heatmapAlt="map" photoAlt="photo" {...props} />,
  )
  return screen.getByRole('button', { name: /show your original photo/i })
}

describe('SaliencyMap', () => {
  it('shows the photo on a tap and hides it on the next', () => {
    const button = renderMap()
    expect(shown()).toBe(false)

    fireEvent.click(button)
    expect(shown()).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toMatch(/your photo/i)

    fireEvent.click(button)
    expect(shown()).toBe(false)
  })

  it('shows nothing when a finger lands on it without tapping', () => {
    const button = renderMap()
    fireEvent.pointerEnter(button, { pointerType: 'touch' })
    expect(shown()).toBe(false)
  })

  it('still peeks on mouse hover', () => {
    const button = renderMap()
    fireEvent.pointerEnter(button, { pointerType: 'mouse' })
    expect(shown()).toBe(true)
    fireEvent.pointerLeave(button, { pointerType: 'mouse' })
    expect(shown()).toBe(false)
  })

  it('is not a button when there is no photo to show', () => {
    render(<SaliencyMap heatmapUrl="/h.png" photoUrl={null} heatmapAlt="map" photoAlt="photo" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByAltText('map')).toBeTruthy()
  })
})
