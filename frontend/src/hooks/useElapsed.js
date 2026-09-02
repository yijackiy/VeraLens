import { useEffect, useState } from 'react'

/**
 * Seconds since `startedAt` (a performance.now() reading), or 0 when nothing
 * is running. Reports what actually elapsed — the interface has no progress
 * channel to report anything else.
 *
 * The clock is read in the interval rather than during render, so the
 * component stays a pure function of its state. A reading left over from a
 * previous analysis is older than the new start and reads as 0.
 */
export function useElapsed(startedAt) {
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (startedAt == null) return undefined
    const timer = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [startedAt])

  if (startedAt == null || now < startedAt) return 0
  return (now - startedAt) / 1000
}
