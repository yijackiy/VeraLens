import { useCallback, useEffect, useState } from 'react'

import {
  applyTheme,
  nextPreference,
  readPreference,
  resolveTheme,
  writePreference,
} from '../lib/theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function prefersDark() {
  return window.matchMedia?.(DARK_QUERY).matches ?? false
}

/**
 * The theme, and the one control that changes it.
 *
 * The boot script in index.html has already stamped data-theme before first
 * paint — this hook takes over from it rather than doing the initial work,
 * which is why the state is seeded from storage again here instead of from
 * the attribute: storage is the preference, the attribute is only its
 * resolved shadow.
 */
export function useTheme() {
  const [preference, setPreference] = useState(() => readPreference(window.localStorage))
  const [systemDark, setSystemDark] = useState(prefersDark)

  const theme = resolveTheme(preference, systemDark)

  useEffect(() => {
    applyTheme(document.documentElement, theme)
  }, [theme])

  // Kept live even when an explicit preference is set: the viewer can switch
  // back to following the system later in the same session, and a stale
  // reading would then resolve to the wrong theme until the next reload.
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY)
    if (!query) return undefined
    const onChange = (event) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setPreference((current) => {
      const chosen = nextPreference(resolveTheme(current, prefersDark()))
      writePreference(window.localStorage, chosen)
      return chosen
    })
  }, [])

  return { theme, preference, toggle }
}
