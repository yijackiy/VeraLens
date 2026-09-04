/**
 * localStorage, defensively.
 *
 * It throws outright — not returns null — in a Safari private window and under
 * a blocked-cookies policy, and the values in it survive deploys, so a string
 * written by an older build can still arrive here. Both are handled by
 * falling back rather than failing: a viewer who cannot store a preference
 * should still get a working page.
 */

export function readStored(storage, key, allowed, fallback) {
  try {
    const value = storage?.getItem(key)
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** Returns whether the write landed, so a caller can tell "saved" from "set". */
export function writeStored(storage, key, value, allowed, fallback) {
  try {
    storage?.setItem(key, allowed.includes(value) ? value : fallback)
    return true
  } catch {
    return false
  }
}
