#!/usr/bin/env bun
/**
 * Phase 1 voice sweep — role × model matrix harness.
 *
 * Drives the existing /voice-test slash command across every (role, model)
 * pair to rank models per Council role. Output feeds the thesis methodology
 * chapter ("which model best plays which role, on what prompts").
 *
 * Two modes:
 *
 *   bun scripts/voice-sweep.ts plan [--roles=empiricist,methodologist] [--models=mathstral:7b-council,...] [--by=role|model]
 *     → prints the full matrix of /voice-test commands to stdout. Pipe to a
 *       file, or paste into Council interactively. Optional filters narrow
 *       the matrix. --by controls iteration order:
 *         --by=role  (default): all models for role 1, then all models for role 2, ...
 *         --by=model: all roles for model 1, then all roles for model 2, ...
 *       Use --by=model for the full 84-cell sweep — Ollama keeps the model
 *       resident across its 6 role-tests, saving ~14 cold-loads' worth of
 *       wall-clock time (each cold-load is 10–60 s on WSL2).
 *
 *   bun scripts/voice-sweep.ts report [--since=<ISO timestamp>] [--out=<csv path>]
 *     → reads ~/.openclaude/voice-tests.jsonl, filters to entries at-or-after
 *       --since (defaults to start-of-today UTC), produces a CSV summary
 *       grouped by (role, modelTag).
 *
 * The prompt-per-role matrix lives in voice-sweep-prompts.json (sibling
 * file). Edit there to change prompts without touching the script.
 *
 * The model list is read from ~/.openclaude/settings.json `agentModels`
 * block — so newly-pulled models registered there join the sweep
 * automatically.
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROMPTS_PATH = join(SCRIPT_DIR, 'voice-sweep-prompts.json')
const SETTINGS_PATH = join(homedir(), '.openclaude', 'settings.json')
const VOICE_TESTS_PATH = join(homedir(), '.openclaude', 'voice-tests.jsonl')

interface PromptEntry {
  prompt: string
  rationale: string
}
interface PromptMatrix {
  roles: Record<string, PromptEntry>
}

interface VoiceTestRecord {
  testId: string
  timestamp: string
  role: string
  modelTag: string
  prompt: string
  status: 'complete' | 'cap-hit' | 'format-error' | 'error'
  finishReason: string
  outputLen: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  errorMessage?: string
}

function loadPrompts(): PromptMatrix {
  if (!existsSync(PROMPTS_PATH)) {
    throw new Error(`Prompt matrix missing at ${PROMPTS_PATH}`)
  }
  return JSON.parse(readFileSync(PROMPTS_PATH, 'utf8'))
}

function loadModels(): string[] {
  if (!existsSync(SETTINGS_PATH)) {
    throw new Error(`Settings file missing at ${SETTINGS_PATH}`)
  }
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))
  const tags = Object.keys(settings.agentModels ?? {})
  if (tags.length === 0) {
    throw new Error(`agentModels block in ${SETTINGS_PATH} is empty`)
  }
  return tags
}

function parseFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function parseListFlag(argv: string[], name: string): string[] | undefined {
  const raw = parseFlag(argv, name)
  if (!raw) return undefined
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function shellEscape(s: string): string {
  // /voice-test parses a quoted prompt at the end. Escape internal double
  // quotes; preserve newlines as literal '\n' so the command stays one line.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function runPlan(argv: string[]): void {
  const prompts = loadPrompts()
  const allModels = loadModels()

  const roleFilter = parseListFlag(argv, 'roles')
  const modelFilter = parseListFlag(argv, 'models')

  const roles = Object.keys(prompts.roles).filter(r =>
    roleFilter ? roleFilter.includes(r) : true,
  )
  const models = allModels.filter(m =>
    modelFilter ? modelFilter.includes(m) : true,
  )

  if (roles.length === 0) {
    console.error(`No roles matched filter ${JSON.stringify(roleFilter)}`)
    process.exit(1)
  }
  if (models.length === 0) {
    console.error(`No models matched filter ${JSON.stringify(modelFilter)}`)
    process.exit(1)
  }

  const by = parseFlag(argv, 'by') ?? 'role'
  if (by !== 'role' && by !== 'model') {
    console.error(`Invalid --by value: ${by} (must be 'role' or 'model')`)
    process.exit(1)
  }

  const total = roles.length * models.length
  console.log(`# Voice sweep plan: ${roles.length} roles × ${models.length} models = ${total} tests`)
  console.log(`# Roles:  ${roles.join(', ')}`)
  console.log(`# Models: ${models.join(', ')}`)
  console.log(`# Order:  by=${by} (${by === 'model' ? 'each model tested on all roles consecutively — saves cold-loads' : 'each role tested on all models consecutively'})`)
  console.log(`# Generated: ${new Date().toISOString()}`)
  console.log('#')
  console.log('# Paste each line into a running Council session. Each test')
  console.log('# appends one record to ~/.openclaude/voice-tests.jsonl.')
  console.log('# When done, run: bun scripts/voice-sweep.ts report')
  console.log('')

  const emitCell = (role: string, model: string): void => {
    const entry = prompts.roles[role]
    if (!entry) return
    console.log(`/voice-test ${role} ${model} "${shellEscape(entry.prompt)}"`)
  }

  if (by === 'role') {
    for (const role of roles) {
      const entry = prompts.roles[role]
      if (!entry) {
        console.error(`# WARN: no prompt defined for role '${role}', skipping`)
        continue
      }
      console.log(`# ──── role: ${role} ────`)
      console.log(`# rationale: ${entry.rationale}`)
      for (const model of models) emitCell(role, model)
      console.log('')
    }
  } else {
    // by=model: outer loop is model, inner loop is role
    for (const model of models) {
      console.log(`# ──── model: ${model} ────`)
      for (const role of roles) {
        const entry = prompts.roles[role]
        if (!entry) {
          console.error(`# WARN: no prompt defined for role '${role}', skipping`)
          continue
        }
        emitCell(role, model)
      }
      console.log('')
    }
  }
}

function readJsonl(path: string): VoiceTestRecord[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const records: VoiceTestRecord[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // Skip malformed line; voice-test JSONL is append-only and corruption
      // is rare, so swallowing is safer than aborting the whole report.
    }
  }
  return records
}

function startOfTodayUtc(): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return d.toISOString()
}

function csvEscape(s: string | number): string {
  const str = String(s)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function runReport(argv: string[]): void {
  const sinceArg = parseFlag(argv, 'since') ?? startOfTodayUtc()
  const sinceMs = Date.parse(sinceArg)
  if (Number.isNaN(sinceMs)) {
    console.error(`Invalid --since value: ${sinceArg}`)
    process.exit(1)
  }
  const outPath = parseFlag(argv, 'out')

  const records = readJsonl(VOICE_TESTS_PATH)
  const filtered = records.filter(r => Date.parse(r.timestamp) >= sinceMs)

  if (filtered.length === 0) {
    console.error(`# No voice-test records at or after ${new Date(sinceMs).toISOString()}`)
    console.error(`# Source: ${VOICE_TESTS_PATH} (${records.length} total records)`)
    process.exit(0)
  }

  // CSV columns: stable, machine-parseable, suitable for thesis appendix
  const header = [
    'role',
    'modelTag',
    'status',
    'finishReason',
    'durationMs',
    'inputTokens',
    'outputTokens',
    'outputLen',
    'costUsd',
    'timestamp',
    'testId',
    'errorMessage',
  ]
  const lines: string[] = [header.join(',')]
  // Sort by (role, modelTag, timestamp) so the CSV groups naturally
  filtered.sort((a, b) => {
    if (a.role !== b.role) return a.role.localeCompare(b.role)
    if (a.modelTag !== b.modelTag) return a.modelTag.localeCompare(b.modelTag)
    return a.timestamp.localeCompare(b.timestamp)
  })
  for (const r of filtered) {
    lines.push([
      r.role,
      r.modelTag,
      r.status,
      r.finishReason ?? '',
      r.durationMs,
      r.inputTokens,
      r.outputTokens,
      r.outputLen,
      r.costUsd,
      r.timestamp,
      r.testId,
      r.errorMessage ?? '',
    ].map(csvEscape).join(','))
  }
  const csv = lines.join('\n') + '\n'

  if (outPath) {
    const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, csv, 'utf8')
    console.error(`# Wrote ${filtered.length} records to ${outPath}`)
  } else {
    process.stdout.write(csv)
  }

  // Also emit a compact human-readable summary to stderr
  const byRole = new Map<string, Map<string, VoiceTestRecord[]>>()
  for (const r of filtered) {
    if (!byRole.has(r.role)) byRole.set(r.role, new Map())
    const m = byRole.get(r.role)!
    if (!m.has(r.modelTag)) m.set(r.modelTag, [])
    m.get(r.modelTag)!.push(r)
  }
  console.error('')
  console.error('# Summary (role / model → status counts):')
  for (const [role, models] of byRole) {
    console.error(`#   ${role}:`)
    for (const [model, rs] of models) {
      const counts = new Map<string, number>()
      for (const r of rs) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
      const parts = [...counts].map(([s, n]) => `${s}=${n}`).join(' ')
      const avgMs = Math.round(rs.reduce((a, r) => a + r.durationMs, 0) / rs.length)
      console.error(`#     ${model.padEnd(28)} ${parts.padEnd(28)} avg=${avgMs}ms (n=${rs.length})`)
    }
  }
}

function usage(): never {
  console.error('Usage:')
  console.error('  bun scripts/voice-sweep.ts plan [--roles=r1,r2] [--models=m1,m2]')
  console.error('  bun scripts/voice-sweep.ts report [--since=<ISO>] [--out=<csv path>]')
  process.exit(2)
}

const [, , mode, ...rest] = process.argv
if (mode === 'plan') runPlan(rest)
else if (mode === 'report') runReport(rest)
else usage()
