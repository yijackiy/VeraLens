import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Contrast is asserted against index.css itself, not against a copy of the
 * palette kept here. A test that restates the hex values proves the test file
 * agrees with itself; this one fails when someone edits a token.
 *
 * It exists because three pairs in the original palette were below AA and
 * nobody noticed: white on sage at 3.78:1 on every primary button, `outline`
 * on paper at 4.48:1 — a miss of 0.02 — under the honesty caveats, and
 * `terracotta` at 2.66:1 under the 3:1 floor for meaningful non-text.
 */

const CSS = readFileSync(
  fileURLToPath(new URL('../index.css', import.meta.url)),
  'utf8',
)

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function ratio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

/** The colour declarations inside one brace-delimited block. */
function paletteFrom(startPattern) {
  const start = CSS.search(startPattern)
  if (start === -1) throw new Error(`no block matching ${startPattern}`)
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('\n}', open)
  const body = CSS.slice(open, close)

  const palette = {}
  for (const [, name, hex] of body.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    palette[name] = hex
  }
  return palette
}

const light = paletteFrom(/@theme\s*\{/)
const dark = { ...light, ...paletteFrom(/:root\[data-theme="dark"\]\s*\{/) }

// Foreground, background, and what the foreground is doing there. Text needs
// 4.5:1 (none of it is large enough for the 3:1 allowance); a mark that
// carries meaning on its own needs 3:1.
const TEXT_PAIRS = [
  ['ink', 'surface'],
  ['ink', 'paper'],
  ['ink-strong', 'paper'],
  ['ink-muted', 'paper'],
  ['ink-muted', 'surface'],
  ['ink-muted', 'tint'],
  ['ink-muted', 'container-high'],
  ['outline', 'paper'],
  ['outline', 'surface'],
  ['on-sage', 'sage-deep'],
  ['on-sage', 'sage-ink'],
  ['sage-deep', 'sage-tint'],
  ['sage-ink', 'tint'],
  ['terracotta-ink', 'terracotta-tint'],
  ['terracotta-deep', 'terracotta-tint'],
  ['error', 'paper'],
  ['error', 'tint'],
]

const NON_TEXT_PAIRS = [
  ['terracotta', 'paper'],
  ['terracotta', 'surface'],
  ['sage', 'paper'],
  ['sage-deep', 'paper'],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (themeName, palette) => {
  it('defines every token the pairs below reference', () => {
    const referenced = new Set([...TEXT_PAIRS, ...NON_TEXT_PAIRS].flat())
    for (const token of referenced) {
      expect(palette[token], `--color-${token} in ${themeName}`).toBeDefined()
    }
  })

  it.each(TEXT_PAIRS)('%s on %s clears 4.5:1 for text', (fg, bg) => {
    expect(ratio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s clears 3:1 as a meaningful mark', (fg, bg) => {
    expect(ratio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(3)
  })
})

describe('the palette itself', () => {
  it('gives dark a different ground from light', () => {
    expect(dark.surface).not.toBe(light.surface)
    expect(dark.paper).not.toBe(light.paper)
  })

  it('keeps slate constant, because it is a photo well and not a text colour', () => {
    expect(dark.slate).toBe(light.slate)
  })
})
