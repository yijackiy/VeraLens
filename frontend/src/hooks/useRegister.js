import { useCallback, useSyncExternalStore } from 'react'

import { normaliseRegister, readRegister, writeRegister } from '../lib/register'

// One register for the whole page. The How-this-works dialog opens on top of a
// verdict or a comparison, so two toggles can be on screen at once; flipping
// either has to move both, or they disagree about which register is showing.
// Held in memory as well as storage: with storage blocked, the toggle still
// has to work for the rest of the visit.
const listeners = new Set()
let current = null

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  if (current === null) current = readRegister(window.localStorage)
  return current
}

/**
 * The Explanation Register, remembered across sessions next to the theme.
 */
export function useRegister() {
  const register = useSyncExternalStore(subscribe, getSnapshot)

  const setRegister = useCallback((next) => {
    current = normaliseRegister(next)
    writeRegister(window.localStorage, current)
    listeners.forEach((listener) => listener())
  }, [])

  return { register, setRegister, technical: register === 'technical' }
}
