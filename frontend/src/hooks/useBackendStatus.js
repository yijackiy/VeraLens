import { useCallback, useEffect, useState } from 'react'
import { ping } from '../api/client'

/**
 * Is there an analysis server to talk to?
 *
 * Without this the first sign that the backend is down is a failed analysis,
 * which looks exactly like a failed photo. /health is dependency-free and
 * answers in milliseconds even while a 90-second analysis is running, so
 * asking on arrival costs nothing.
 */
export function useBackendStatus() {
  const [status, setStatus] = useState('checking')

  const check = useCallback(async () => {
    setStatus('checking')
    setStatus((await ping()) ? 'up' : 'down')
  }, [])

  useEffect(() => {
    let live = true
    ping().then((ok) => {
      if (live) setStatus(ok ? 'up' : 'down')
    })
    return () => {
      live = false
    }
  }, [])

  return { status, check }
}
