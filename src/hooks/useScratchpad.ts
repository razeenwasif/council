import { useEffect, useState } from 'react'
import { getNotes, subscribe } from '../utils/scratchpadStore.js'

/**
 * React hook that subscribes to the session scratchpad store. Returns
 * the current notes array; re-renders the consumer whenever `/note`
 * appends or clears.
 */
export function useScratchpad(): readonly string[] {
  const [notes, setNotes] = useState<readonly string[]>(() => getNotes())
  useEffect(() => subscribe(setNotes), [])
  return notes
}
