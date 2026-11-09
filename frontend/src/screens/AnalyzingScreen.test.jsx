/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AnalyzingScreen } from './AnalyzingScreen'

/**
 * The waiting screen, with and without the server's word on where it is.
 *
 * What these pin is honesty more than layout. The bar is steps, never a
 * percentage; nothing on it reads as finished before the response lands; the
 * wait for the graphics card is named; and with no report at all the screen
 * falls back to saying its markers are timing, not live progress.
 */
afterEach(cleanup)

function renderScreen(props = {}) {
  return render(
    <AnalyzingScreen fileName="portrait.jpg" elapsed={5} onCancel={() => {}} onHowItWorks={() => {}} {...props} />,
  )
}

const bar = () => screen.getByRole('progressbar', { name: 'Analysis progress' })

describe('with no report from the server', () => {
  it('shows an indeterminate bar, not a number', () => {
    renderScreen()
    expect(bar().getAttribute('aria-valuenow')).toBeNull()
    expect(bar().getAttribute('aria-valuetext')).toBe('Starting')
  })

  it('marks steps from typical timing and says so, never "running now"', () => {
    renderScreen({ elapsed: 30 })
    expect(screen.getByText('Expected now')).toBeTruthy()
    expect(screen.queryByText('Running now')).toBeNull()
    expect(screen.getByText(/marked by typical timing, not live progress/)).toBeTruthy()
  })
})

describe('with the server reporting', () => {
  it('says which step is running, in the server\'s words not the clock\'s', () => {
    // 90 seconds in, the clock would say "writing". The server says it has
    // only just begun the classifier — the server is right.
    renderScreen({ elapsed: 90, progress: { stage: 'classifying' } })
    expect(screen.getByText('Running now')).toBeTruthy()
    expect(bar().getAttribute('aria-valuetext')).toBe('Step 2 of 4 · Fake Probability')
    expect(screen.queryByText('Expected now')).toBeNull()
  })

  it('counts steps done, and never reaches all four while an analysis is running', () => {
    for (const stage of ['queued', 'classifying', 'saliency', 'loading', 'writing']) {
      renderScreen({ progress: { stage } })
      expect(Number(bar().getAttribute('aria-valuenow'))).toBeLessThan(4)
      expect(bar().getAttribute('aria-valuemax')).toBe('4')
      cleanup()
    }
  })

  it('names the wait for the graphics card', () => {
    renderScreen({ progress: { stage: 'queued' } })
    expect(bar().getAttribute('aria-valuetext')).toBe('Waiting for the graphics card')
    expect(screen.getByText(/Another analysis is still running/)).toBeTruthy()
  })

  it('does not name a wait that is not happening', () => {
    renderScreen({ progress: { stage: 'writing', attempt: 1, max_attempts: 3, tokens: 12 } })
    expect(screen.queryByText(/Another analysis is still running/)).toBeNull()
  })

  it('says in plain words that the model is still writing', () => {
    renderScreen({ progress: { stage: 'writing', attempt: 1, max_attempts: 3, tokens: 87 } })
    expect(screen.getByText('Still writing — working, not stuck')).toBeTruthy()
  })

  it('keeps the exact count one hover away, and out of the visible and announced text', () => {
    // "Tokens" is not a word most readers have, and a count that changes
    // several times a second must not be read out as it goes.
    renderScreen({ progress: { stage: 'writing', attempt: 1, max_attempts: 3, tokens: 87 } })
    const heartbeat = screen.getByText('Still writing — working, not stuck').closest('[title]')
    expect(heartbeat.getAttribute('title')).toBe('87 tokens written so far')
    expect(heartbeat.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.textContent).not.toMatch(/87/)
    expect(bar().getAttribute('aria-valuetext')).not.toMatch(/token/)
  })

  it('explains a second attempt as a reply that could not be read', () => {
    renderScreen({ progress: { stage: 'writing', attempt: 2, max_attempts: 3, tokens: 4 } })
    expect(screen.getByText(/writing it again \(attempt 2 of 3\)/)).toBeTruthy()
  })

  it('says nothing about a retry on the first attempt', () => {
    renderScreen({ progress: { stage: 'writing', attempt: 1, max_attempts: 3, tokens: 4 } })
    expect(screen.queryByText(/writing it again/)).toBeNull()
  })

  it('explains the model loading, which only the first analysis after start-up pays for', () => {
    renderScreen({ progress: { stage: 'loading' } })
    expect(screen.getByText(/first analysis after the server starts/)).toBeTruthy()
    expect(screen.queryByText(/Still writing/)).toBeNull()
  })

  it('draws the bar from steps — no widths, and no percentage in anything it says', () => {
    // Scoped to the bar and its caption on purpose: the page around it has
    // honest percentages of its own ("from 0% to 100%", the classifier's
    // accuracy). What must never appear is a fill that claims how far along
    // the wait is.
    renderScreen({ progress: { stage: 'writing', attempt: 1, max_attempts: 3, tokens: 87 } })
    const region = bar().parentElement
    expect(region.innerHTML).not.toMatch(/width/i)
    expect(region.textContent).not.toMatch(/\d\s?%/)
  })
})
