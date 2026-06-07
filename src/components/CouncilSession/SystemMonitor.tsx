import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { readSystemStats, type SystemStats } from '../../utils/systemStats.js'

const ACCENT = 'rgb(255,106,0)'

/**
 * Compact system monitor pane — fills the dead space at the bottom of the
 * left column under the discover voice list. Tracks CPU%, RAM, GPU%/VRAM,
 * disk I/O MB/s, network I/O MB/s, and this Node process's own resource
 * use. Polls every 2s; the first sample renders mostly zeros (CPU and
 * rate stats need two samples to compute deltas).
 *
 * Layout: each stat is one line. Numeric formats are abbreviated so the
 * whole thing fits in the ~18 inner cols of the VOICE_LIST_WIDTH=22 pane.
 * Bars are 6 chars (8th-block characters for sub-cell precision is overkill
 * at this size — flat hashes are crisper at small widths).
 */

const POLL_MS = 2000
const BAR_WIDTH = 6

function bar(pct: number, width = BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = Math.round((clamped / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function pctColor(pct: number): string | undefined {
  if (pct >= 85) return 'red'
  if (pct >= 60) return 'yellow'
  return undefined
}

/** "12.3" / "1.2K" / "3.4M" — compact MB number display. */
function fmtMB(mb: number): string {
  if (mb >= 1000) return (mb / 1024).toFixed(1) + 'G'
  if (mb >= 100) return mb.toFixed(0) + 'M'
  if (mb >= 10) return mb.toFixed(1) + 'M'
  return mb.toFixed(2) + 'M'
}

/** "0.1" / "12" / "999+" MB/s — fits in 4 chars. */
function fmtRate(mbps: number): string {
  if (mbps < 0.1) return '0.0'
  if (mbps < 10) return mbps.toFixed(1)
  if (mbps < 100) return mbps.toFixed(0)
  return '99+'
}

export function SystemMonitor({
  availableColumns,
}: {
  availableColumns: number
}): React.ReactNode {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const prevRef = useRef<SystemStats | null>(null)
  // Track whether the component is still mounted so an in-flight async
  // read can't setState after unmount.
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    async function tick() {
      try {
        const next = await readSystemStats(prevRef.current ?? undefined)
        if (cancelled || !mountedRef.current) return
        prevRef.current = next
        setStats(next)
      } catch {
        // Swallow — the monitor is best-effort, never block the UI.
      }
    }
    // Immediate first read so the pane doesn't sit empty for 2s on mount.
    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      mountedRef.current = false
      clearInterval(id)
    }
  }, [])

  if (!stats) {
    return (
      <Box paddingX={1} width={availableColumns}>
        <Text dimColor italic>
          gathering…
        </Text>
      </Box>
    )
  }

  const cpuPct = Math.round(stats.cpu.pct)
  const ramPct = Math.round(stats.ram.pct)
  const ramUsedGB = (stats.ram.usedBytes / 1_073_741_824).toFixed(1)
  const ramTotalGB = (stats.ram.totalBytes / 1_073_741_824).toFixed(1)
  const gpu = stats.gpu
  const disk = stats.disk
  const net = stats.net
  const proc = stats.proc

  return (
    <Box flexDirection="column" paddingX={1} width={availableColumns}>
      {/* CPU */}
      <Box>
        <Text dimColor>cpu </Text>
        <Text color={pctColor(cpuPct)}>{cpuPct.toString().padStart(3)}%</Text>
        <Text> </Text>
        <Text color={ACCENT}>{bar(cpuPct)}</Text>
      </Box>
      {/* RAM */}
      <Box>
        <Text dimColor>ram </Text>
        <Text color={pctColor(ramPct)}>{ramPct.toString().padStart(3)}%</Text>
        <Text> </Text>
        <Text color={ACCENT}>{bar(ramPct)}</Text>
      </Box>
      <Box>
        <Text dimColor>    </Text>
        <Text dimColor>
          {ramUsedGB}/{ramTotalGB}G
        </Text>
      </Box>
      {/* GPU */}
      {gpu ? (
        <>
          <Box>
            <Text dimColor>gpu </Text>
            <Text color={pctColor(gpu.util)}>{gpu.util.toString().padStart(3)}%</Text>
            <Text> </Text>
            <Text color={ACCENT}>{bar(gpu.util)}</Text>
          </Box>
          <Box>
            <Text dimColor>    </Text>
            <Text dimColor>
              {(gpu.memUsedMB / 1024).toFixed(1)}/{(gpu.memTotalMB / 1024).toFixed(1)}G
            </Text>
          </Box>
        </>
      ) : (
        <Box>
          <Text dimColor italic>gpu n/a</Text>
        </Box>
      )}
      {/* Disk */}
      {disk && (
        <Box>
          <Text dimColor>dsk </Text>
          <Text>r{fmtRate(disk.readMBps)}</Text>
          <Text dimColor> w</Text>
          <Text>{fmtRate(disk.writeMBps)}</Text>
        </Box>
      )}
      {/* Network */}
      {net && (
        <Box>
          <Text dimColor>net </Text>
          <Text>↓{fmtRate(net.rxMBps)}</Text>
          <Text dimColor> ↑</Text>
          <Text>{fmtRate(net.txMBps)}</Text>
        </Box>
      )}
      {/* This process */}
      <Box>
        <Text dimColor>proc </Text>
        <Text>{fmtMB(proc.memMB)}</Text>
        <Text dimColor> </Text>
        <Text color={pctColor(proc.cpuPct)}>{Math.round(proc.cpuPct)}%</Text>
      </Box>
    </Box>
  )
}
