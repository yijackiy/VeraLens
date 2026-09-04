import { useCallback, useState } from 'react'

import { readRegister, writeRegister } from '../lib/register'

/**
 * The Explanation Register, remembered across sessions next to the theme.
 *
 * Only one screen that uses this is ever mounted at a time — a verdict or a
 * comparison, never both — so a single piece of local state is enough; there
 * is nothing to keep in sync.
 */
export function useRegister() {
  const [register, setRegisterState] = useState(() => readRegister(window.localStorage))

  const setRegister = useCallback((next) => {
    writeRegister(window.localStorage, next)
    setRegisterState(next)
  }, [])

  return { register, setRegister, technical: register === 'technical' }
}
