/**
 * System monitor stats reader for the Council UI's left-column monitor pane.
 *
 * Linux-first (the user's primary deployment is WSL2). Each stat reader
 * is independently try/catched so a missing source (e.g. no nvidia-smi)
 * never breaks the others. Returns absolute values plus rates derived
 * from the previous sample — callers pass the prior `SystemStats` so
 * the rate calculations (CPU%, disk MB/s, network MB/s, process CPU%)
 * have a delta to work against.
 *
 * The display layer (SystemMonitor.tsx) is responsible for formatting;
 * this module returns raw numbers + units only.
 */

import { promises as fs } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execAsync = promisify(exec)

export type SystemStats = {
  /** Wall-clock time of this sample (ms since epoch). */
  ts: number
  /** Overall CPU percentage (0-100). */
  cpu: { pct: number; rawTotal: number; rawIdle: number }
  /** Memory used / total in bytes. */
  ram: { usedBytes: number; totalBytes: number; pct: number }
  /** GPU stats from nvidia-smi, undefined if unavailable. */
  gpu?: { util: number; memUsedMB: number; memTotalMB: number }
  /** Aggregated disk I/O in MB/s since the previous sample. */
  disk?: { readMBps: number; writeMBps: number; rawReadBytes: number; rawWriteBytes: number }
  /** Aggregated network I/O in MB/s since the previous sample. */
  net?: { rxMBps: number; txMBps: number; rawRxBytes: number; rawTxBytes: number }
  /** This Node process's own resource use. */
  proc: { memMB: number; cpuPct: number; rawCpuUsage: { user: number; system: number } }
}

/** Read /proc/stat first line; sum all fields = total, idle field = idle. */
async function readCpuRaw(): Promise<{ total: number; idle: number } | null> {
  try {
    const content = await fs.readFile('/proc/stat', 'utf8')
    const firstLine = content.split('\n', 1)[0] ?? ''
    // "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
    const parts = firstLine.trim().split(/\s+/).slice(1).map(Number)
    if (parts.length < 4 || parts.some(n => Number.isNaN(n))) return null
    const total = parts.reduce((a, b) => a + b, 0)
    const idle = parts[3]! + (parts[4] ?? 0) // idle + iowait
    return { total, idle }
  } catch {
    return null
  }
}

/** Read /proc/meminfo for total + available memory. */
async function readMemInfo(): Promise<{ totalBytes: number; availableBytes: number } | null> {
  try {
    const content = await fs.readFile('/proc/meminfo', 'utf8')
    const get = (key: string): number | undefined => {
      const m = content.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm'))
      return m ? Number(m[1]) * 1024 : undefined
    }
    const total = get('MemTotal')
    const available = get('MemAvailable')
    if (total === undefined || available === undefined) return null
    return { totalBytes: total, availableBytes: available }
  } catch {
    return null
  }
}

/** Query nvidia-smi for GPU utilization + VRAM. Returns null if unavailable. */
async function readGpu(): Promise<{ util: number; memUsedMB: number; memTotalMB: number } | null> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 1500 },
    )
    // First GPU only; multi-GPU systems get GPU0 as a reasonable default.
    const firstLine = stdout.split('\n').find(l => l.trim().length > 0)
    if (!firstLine) return null
    const [utilStr, usedStr, totalStr] = firstLine.split(',').map(s => s.trim())
    const util = Number(utilStr)
    const memUsedMB = Number(usedStr)
    const memTotalMB = Number(totalStr)
    if ([util, memUsedMB, memTotalMB].some(Number.isNaN)) return null
    return { util, memUsedMB, memTotalMB }
  } catch {
    return null
  }
}

/** Read /proc/diskstats; sum reads + writes across real disks (skip loop/ram). */
async function readDiskRaw(): Promise<{ readBytes: number; writeBytes: number } | null> {
  try {
    const content = await fs.readFile('/proc/diskstats', 'utf8')
    let readSectors = 0
    let writeSectors = 0
    for (const line of content.split('\n')) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 10) continue
      const name = fields[2]!
      // Skip loopback, ram, dm-N partitions to avoid double counting.
      if (/^(loop|ram|dm-)/.test(name)) continue
      // Skip per-partition (sda1, nvme0n1p1) — keep whole-disk counters only.
      if (/\d$/.test(name) && !/^nvme\d+n\d+$/.test(name)) continue
      readSectors += Number(fields[5]) || 0
      writeSectors += Number(fields[9]) || 0
    }
    // Sectors are 512 bytes on Linux.
    return { readBytes: readSectors * 512, writeBytes: writeSectors * 512 }
  } catch {
    return null
  }
}

/** Read /proc/net/dev; sum rx/tx across non-loopback interfaces. */
async function readNetRaw(): Promise<{ rxBytes: number; txBytes: number } | null> {
  try {
    const content = await fs.readFile('/proc/net/dev', 'utf8')
    let rxBytes = 0
    let txBytes = 0
    const lines = content.split('\n').slice(2) // skip 2 header lines
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue
      const iface = trimmed.slice(0, colonIdx).trim()
      if (iface === 'lo') continue
      const fields = trimmed.slice(colonIdx + 1).trim().split(/\s+/).map(Number)
      rxBytes += fields[0] || 0
      txBytes += fields[8] || 0
    }
    return { rxBytes, txBytes }
  } catch {
    return null
  }
}

/**
 * Read a fresh sample of all stats. Pass the previous sample so rate-based
 * stats (CPU%, disk MB/s, network MB/s, process CPU%) can compute deltas;
 * the very first call returns 0 for all rates.
 */
export async function readSystemStats(prev?: SystemStats): Promise<SystemStats> {
  const ts = Date.now()
  // Run all I/O in parallel — saves ~3× latency on multi-source reads.
  const [cpuRaw, mem, gpu, diskRaw, netRaw] = await Promise.all([
    readCpuRaw(),
    readMemInfo(),
    readGpu(),
    readDiskRaw(),
    readNetRaw(),
  ])

  // CPU
  let cpuPct = 0
  const cpuTotal = cpuRaw?.total ?? 0
  const cpuIdle = cpuRaw?.idle ?? 0
  if (prev && cpuRaw) {
    const totalDelta = cpuTotal - prev.cpu.rawTotal
    const idleDelta = cpuIdle - prev.cpu.rawIdle
    if (totalDelta > 0) {
      cpuPct = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100))
    }
  }

  // RAM — prefer /proc/meminfo, fall back to os module
  let totalBytes = mem?.totalBytes ?? os.totalmem()
  let usedBytes = mem
    ? mem.totalBytes - mem.availableBytes
    : os.totalmem() - os.freemem()
  const ramPct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0

  // Disk + Network rates
  const elapsedSec = prev ? Math.max(0.001, (ts - prev.ts) / 1000) : 0
  let disk: SystemStats['disk'] | undefined
  if (diskRaw) {
    let readMBps = 0
    let writeMBps = 0
    if (prev?.disk && elapsedSec > 0) {
      readMBps = Math.max(0, (diskRaw.readBytes - prev.disk.rawReadBytes) / elapsedSec / 1_000_000)
      writeMBps = Math.max(0, (diskRaw.writeBytes - prev.disk.rawWriteBytes) / elapsedSec / 1_000_000)
    }
    disk = {
      readMBps,
      writeMBps,
      rawReadBytes: diskRaw.readBytes,
      rawWriteBytes: diskRaw.writeBytes,
    }
  }
  let net: SystemStats['net'] | undefined
  if (netRaw) {
    let rxMBps = 0
    let txMBps = 0
    if (prev?.net && elapsedSec > 0) {
      rxMBps = Math.max(0, (netRaw.rxBytes - prev.net.rawRxBytes) / elapsedSec / 1_000_000)
      txMBps = Math.max(0, (netRaw.txBytes - prev.net.rawTxBytes) / elapsedSec / 1_000_000)
    }
    net = {
      rxMBps,
      txMBps,
      rawRxBytes: netRaw.rxBytes,
      rawTxBytes: netRaw.txBytes,
    }
  }

  // Process stats. process.cpuUsage() returns microseconds total since
  // start; convert to a rate using the prev sample.
  const cpuUsage = process.cpuUsage()
  let procCpuPct = 0
  if (prev && elapsedSec > 0) {
    const userDelta = cpuUsage.user - prev.proc.rawCpuUsage.user
    const sysDelta = cpuUsage.system - prev.proc.rawCpuUsage.system
    // Microseconds → seconds → pct of elapsed wall time.
    procCpuPct = Math.max(0, Math.min(100, ((userDelta + sysDelta) / 1_000_000 / elapsedSec) * 100))
  }
  const procMemMB = process.memoryUsage().rss / 1_048_576

  return {
    ts,
    cpu: { pct: cpuPct, rawTotal: cpuTotal, rawIdle: cpuIdle },
    ram: { usedBytes, totalBytes, pct: ramPct },
    gpu: gpu ?? undefined,
    disk,
    net,
    proc: { memMB: procMemMB, cpuPct: procCpuPct, rawCpuUsage: cpuUsage },
  }
}
