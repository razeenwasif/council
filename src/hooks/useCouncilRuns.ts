import { useEffect, useState } from 'react'

import {
  ensureRunsCacheLoaded,
  getCachedRuns,
  subscribeRunsCache,
  type CouncilRunRecord,
} from '../utils/councilTelemetry.js'

/**
 * Returns the full array of council/discover runs from the telemetry
 * cache, newest-last. Hydrates from disk on first mount; subsequent
 * appends arrive via the cache subscription and trigger re-render.
 *
 * Use with an offset/index in the consumer to render a specific run
 * (e.g. PastSessionView with Alt+H/Alt+L navigation).
 */
export function useCouncilRuns(): readonly CouncilRunRecord[] {
  const [runs, setRuns] = useState<readonly CouncilRunRecord[]>(() =>
    getCachedRuns(),
  )

  useEffect(() => {
    let cancelled = false
    void ensureRunsCacheLoaded().then(() => {
      if (cancelled) return
      setRuns(getCachedRuns().slice())
    })
    const unsub = subscribeRunsCache(() => {
      // Force a re-render with the (mutated) cache. Slice() creates a
      // new reference so React notices.
      setRuns(getCachedRuns().slice())
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  return runs
}
