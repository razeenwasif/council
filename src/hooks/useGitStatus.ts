import { useEffect, useState } from 'react'

import {
  getGitStatusSnapshot,
  subscribeGitStatus,
  type GitStatusSnapshot,
} from '../utils/gitStatusReader.js'

/**
 * Subscribes to the shared git status poller. Mount triggers polling;
 * unmount releases (polling auto-stops when the last subscriber detaches).
 */
export function useGitStatus(): GitStatusSnapshot {
  const [snap, setSnap] = useState<GitStatusSnapshot>(() => getGitStatusSnapshot())
  useEffect(() => subscribeGitStatus(setSnap), [])
  return snap
}
