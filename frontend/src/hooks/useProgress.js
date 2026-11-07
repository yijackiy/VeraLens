import { useEffect, useState } from 'react'
import { getProgress } from '../api/client'

const POLL_MS = 1000

/**
 * The backend's latest report on the Analysis for `token`, or null when there
 * is none yet (or no token — pass null to stop polling).
 *
 * A chain of timeouts rather than an interval, so a slow answer is never
 * followed by a second request on top of it. The first ask goes out at once.
 * The result is kept beside the token it was for and only returned for that
 * token, so the next Analysis never starts by showing the last one's stage.
 *
 * Nothing here can fail the analysis: getProgress() resolves null on any
 * error, and the POST that is actually doing the work reports its own.
 */
export function useProgress(token) {
  const [latest, setLatest] = useState(null)

  useEffect(() => {
    if (!token) return undefined

    let cancelled = false
    let timer
    const controller = new AbortController()

    const poll = async () => {
      const snapshot = await getProgress(token, { signal: controller.signal })
      if (cancelled) return
      if (snapshot) setLatest({ token, snapshot })
      timer = setTimeout(poll, POLL_MS)
    }
    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [token])

  return latest && latest.token === token ? latest.snapshot : null
}
