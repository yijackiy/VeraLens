/**
 * Theme resolution, kept free of React and of the DOM so it can be tested
 * directly. Three preferences collapse to two themes:
 *
 *   'system'  — follow the operating system, and keep following it
 *   'light'   — an explicit choice that outranks the operating system
 *   'dark'    — likewise
 *
 * The distinction matters on the day: a demo laptop set to light because the
 * room is bright should not silently flip when the OS switches at sunset.
 */

export const STORAGE_KEY = 'veralens.theme'

export const PREFERENCES = ['system', 'light', 'dark']

/** The resolved theme: what actually gets stamped on <html>. */
export function resolveTheme(preference, prefersDark) {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  return prefersDark ? 'dark' : 'light'
}

/**
 * Anything unrecognised is treated as 'system', not as an error. The value
 * comes from localStorage, which survives deploys — a preference written by
 * an older build must not be able to wedge the app.
 */
export function normalisePreference(value) {
  return PREFERENCES.includes(value) ? value : 'system'
}

/**
 * One click gives you the opposite of what you are looking at, and it is
 * always an explicit choice: cycling through 'system' would mean pressing
 * twice to get from light to dark whenever the OS already said light.
 * 'system' is therefore a starting state, not a stop on the cycle.
 */
export function nextPreference(resolvedTheme) {
  return resolvedTheme === 'dark' ? 'light' : 'dark'
}

/**
 * Storage access is wrapped because it throws outright — not returns null —
 * in a Safari private window and under a blocked-cookies policy. A viewer
 * who cannot store a preference should still get a working theme.
 */
export function readPreference(storage) {
  try {
    return normalisePreference(storage?.getItem(STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function writePreference(storage, preference) {
  try {
    storage?.setItem(STORAGE_KEY, normalisePreference(preference))
    return true
  } catch {
    return false
  }
}

/**
 * Always an explicit attribute, never absent. index.css carries one dark
 * block keyed on data-theme="dark" rather than duplicating it inside a
 * prefers-color-scheme query, which only works if the OS preference has
 * already been resolved to a concrete value by the time CSS runs.
 */
export function applyTheme(root, theme) {
  root?.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
}
