/**
 * /voice-sweep — in-Council automation of the role × model matrix.
 *
 * Eliminates the manual paste loop: reads the prompts matrix from
 * scripts/voice-sweep-prompts.json + registered model tags from
 * settings.agentModels, then loops `runVoiceCell` over the filtered
 * combinations. Each cell appends one record to ~/.openclaude/voice-tests.jsonl
 * exactly as /voice-test does — same code path, same schema.
 *
 * Flags:
 *   --roles=r1,r2     filter to specific roles (default: all from prompts file)
 *   --models=m1,m2    filter to specific model tags (default: all from agentModels)
 *   --by=model|role   iteration order (default model for cold-load efficiency)
 *   --limit=N         run only the first N cells after ordering (default: all)
 *   --dry-run         print the plan without firing any cells
 *
 * Examples:
 *   /voice-sweep
 *   /voice-sweep --roles=empiricist,methodologist
 *   /voice-sweep --models=mathstral:7b-council,olmo-3:7b-council --limit=4
 *   /voice-sweep --dry-run
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LocalCommandCall } from '../../types/command.js'
import {
  listRegisteredModelTags,
  runVoiceCell,
  type VoiceTestRecord,
} from '../voice-test/runCell.js'

interface PromptEntry {
  prompt: string
  rationale?: string
}
interface PromptMatrix {
  roles: Record<string, PromptEntry>
}

interface ParsedFlags {
  roles?: string[]
  models?: string[]
  by: 'role' | 'model'
  limit?: number
  dryRun: boolean
}

interface Cell {
  role: string
  modelTag: string
  prompt: string
}

const HELP = `Usage: /voice-sweep [--roles=...] [--models=...] [--by=model|role] [--limit=N] [--dry-run]

Loops /voice-test over a (role × model) matrix in-Council. Same JSONL
output as /voice-test, no manual paste.

Flags:
  --roles=r1,r2     filter to specific roles (default: all from prompts file)
  --models=m1,m2    filter to specific model tags (default: all agentModels)
  --by=model|role   iteration order (default model — keeps Ollama loaded)
  --limit=N         run only the first N cells after ordering
  --dry-run         print the plan without firing cells

Prompts file is sourced (in order): COUNCIL_VOICE_SWEEP_PROMPTS env var,
$cwd/scripts/voice-sweep-prompts.json, $cwd/voice-sweep-prompts.json,
~/.openclaude/voice-sweep-prompts.json.

Examples:
  /voice-sweep --dry-run
  /voice-sweep --roles=empiricist
  /voice-sweep --models=mathstral:7b-council,olmo-3:7b-council
  /voice-sweep --limit=4   (smoke test the harness on 4 cells)
`

function findPromptsFile(): string | null {
  const candidates = [
    process.env.COUNCIL_VOICE_SWEEP_PROMPTS,
    join(process.cwd(), 'scripts/voice-sweep-prompts.json'),
    join(process.cwd(), 'voice-sweep-prompts.json'),
    join(homedir(), '.openclaude/voice-sweep-prompts.json'),
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function loadPrompts(): { prompts: PromptMatrix; path: string } | { error: string } {
  const path = findPromptsFile()
  if (!path) {
    return {
      error:
        `voice-sweep: prompts file not found. Tried:\n` +
        `  - $COUNCIL_VOICE_SWEEP_PROMPTS\n` +
        `  - ${join(process.cwd(), 'scripts/voice-sweep-prompts.json')}\n` +
        `  - ${join(process.cwd(), 'voice-sweep-prompts.json')}\n` +
        `  - ${join(homedir(), '.openclaude/voice-sweep-prompts.json')}\n` +
        `Set COUNCIL_VOICE_SWEEP_PROMPTS=<path> or cd to a directory with the file.`,
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PromptMatrix
    if (!parsed.roles || typeof parsed.roles !== 'object') {
      return { error: `voice-sweep: ${path} is missing a 'roles' object` }
    }
    return { prompts: parsed, path }
  } catch (err) {
    return {
      error: `voice-sweep: failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function parseFlags(raw: string): ParsedFlags | { error: string } {
  const flags: ParsedFlags = { by: 'model', dryRun: false }
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    if (tok === '--dry-run') {
      flags.dryRun = true
    } else if (tok === '--help' || tok === '-h') {
      return { error: 'help' }
    } else if (tok.startsWith('--roles=')) {
      flags.roles = tok.slice('--roles='.length).split(',').map(s => s.trim()).filter(Boolean)
    } else if (tok.startsWith('--models=')) {
      flags.models = tok.slice('--models='.length).split(',').map(s => s.trim()).filter(Boolean)
    } else if (tok.startsWith('--by=')) {
      const v = tok.slice('--by='.length)
      if (v !== 'model' && v !== 'role') {
        return { error: `--by must be 'model' or 'role', got '${v}'` }
      }
      flags.by = v
    } else if (tok.startsWith('--limit=')) {
      const n = parseInt(tok.slice('--limit='.length), 10)
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `--limit must be a positive integer, got '${tok}'` }
      }
      flags.limit = n
    } else {
      return { error: `unknown flag '${tok}' — see /voice-sweep --help` }
    }
  }
  return flags
}

function buildCells(
  roles: string[],
  models: string[],
  prompts: PromptMatrix,
  by: 'role' | 'model',
): Cell[] {
  const cells: Cell[] = []
  const outer = by === 'model' ? models : roles
  const inner = by === 'model' ? roles : models
  for (const o of outer) {
    for (const i of inner) {
      const role = by === 'model' ? i : o
      const modelTag = by === 'model' ? o : i
      const entry = prompts.roles[role]
      if (!entry) continue
      cells.push({ role, modelTag, prompt: entry.prompt })
    }
  }
  return cells
}

function formatPlan(cells: Cell[], by: 'role' | 'model'): string {
  const lines = [
    `# /voice-sweep plan: ${cells.length} cells (by=${by})`,
    `# (use without --dry-run to fire them)`,
    '',
  ]
  let lastGroup = ''
  for (const c of cells) {
    const group = by === 'model' ? c.modelTag : c.role
    if (group !== lastGroup) {
      lines.push(`# ──── ${by}: ${group} ────`)
      lastGroup = group
    }
    lines.push(`/voice-test ${c.role} ${c.modelTag} "<prompt>"`)
  }
  return lines.join('\n')
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

function formatSweepResult(
  records: VoiceTestRecord[],
  validationErrors: string[],
  totalDurationMs: number,
): string {
  const lines: string[] = []
  const total = records.length
  const counts = {
    complete: records.filter(r => r.status === 'complete').length,
    capHit: records.filter(r => r.status === 'cap-hit').length,
    error: records.filter(r => r.status === 'error').length,
  }
  lines.push(
    `voice-sweep done: ${total} cells in ${fmtMs(totalDurationMs)} · ` +
      `complete=${counts.complete} cap-hit=${counts.capHit} error=${counts.error}`,
  )
  if (validationErrors.length > 0) {
    lines.push('')
    lines.push(`Skipped ${validationErrors.length} cell(s) due to validation errors:`)
    for (const e of validationErrors.slice(0, 5)) lines.push(`  - ${e}`)
    if (validationErrors.length > 5) {
      lines.push(`  (and ${validationErrors.length - 5} more)`)
    }
  }

  // Per-model summary table
  const byModel = new Map<string, VoiceTestRecord[]>()
  for (const r of records) {
    if (!byModel.has(r.modelTag)) byModel.set(r.modelTag, [])
    byModel.get(r.modelTag)!.push(r)
  }
  if (byModel.size > 1) {
    lines.push('')
    lines.push('Per-model summary:')
    for (const [model, rs] of [...byModel].sort((a, b) => a[0].localeCompare(b[0]))) {
      const c = rs.filter(r => r.status === 'complete').length
      const k = rs.filter(r => r.status === 'cap-hit').length
      const e = rs.filter(r => r.status === 'error').length
      const avgMs = Math.round(rs.reduce((s, r) => s + r.durationMs, 0) / rs.length)
      lines.push(
        `  ${model.padEnd(28)}  complete=${c} cap-hit=${k} error=${e}  avg=${fmtMs(avgMs)}  (n=${rs.length})`,
      )
    }
  }

  lines.push('')
  lines.push('Run `bun scripts/voice-sweep.ts report --since=<ISO>` for the full CSV.')
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args, context) => {
  const raw = (args ?? '').trim()
  if (raw === 'help' || raw === '--help' || raw === '-h') {
    return { type: 'text', value: HELP }
  }

  const flagsOrError = parseFlags(raw)
  if ('error' in flagsOrError) {
    if (flagsOrError.error === 'help') {
      return { type: 'text', value: HELP }
    }
    return { type: 'text', value: `voice-sweep: ${flagsOrError.error}\n\n${HELP}` }
  }
  const flags = flagsOrError

  const promptsOrError = loadPrompts()
  if ('error' in promptsOrError) {
    return { type: 'text', value: promptsOrError.error }
  }
  const { prompts, path: promptsPath } = promptsOrError

  // Resolve roles + models
  const allRolesFromPrompts = Object.keys(prompts.roles)
  const roles = flags.roles
    ? flags.roles.filter(r => allRolesFromPrompts.includes(r))
    : allRolesFromPrompts
  if (roles.length === 0) {
    return {
      type: 'text',
      value:
        `voice-sweep: no roles matched filter ${JSON.stringify(flags.roles)}.\n` +
        `Roles defined in ${promptsPath}: ${allRolesFromPrompts.join(', ')}`,
    }
  }

  const allModels = listRegisteredModelTags()
  const models = flags.models
    ? flags.models.filter(m => allModels.includes(m))
    : allModels
  if (models.length === 0) {
    return {
      type: 'text',
      value:
        `voice-sweep: no models matched filter ${JSON.stringify(flags.models)}.\n` +
        `Registered model tags: ${allModels.join(', ') || '(none — populate ~/.openclaude/settings.json agentModels)'}`,
    }
  }

  let cells = buildCells(roles, models, prompts, flags.by)
  if (flags.limit) cells = cells.slice(0, flags.limit)

  if (flags.dryRun) {
    const planHeader = [
      `# Resolved: ${roles.length} roles × ${models.length} models = ${cells.length} cells`,
      `# Prompts:  ${promptsPath}`,
      `# Order:    by=${flags.by}`,
      `# Roles:    ${roles.join(', ')}`,
      `# Models:   ${models.join(', ')}`,
      '',
    ].join('\n')
    return { type: 'text', value: planHeader + formatPlan(cells, flags.by) }
  }

  if (cells.length === 0) {
    return { type: 'text', value: 'voice-sweep: zero cells to run (nothing matched).' }
  }

  // Execute serially. Per-cell panel injection happens via runSingleAgentFromToolContext
  // (same as /voice-test) — user sees progress in the agent thoughts pane.
  const sweepStart = Date.now()
  const records: VoiceTestRecord[] = []
  const validationErrors: string[] = []
  const abortSignal = context.abortController?.signal

  for (let i = 0; i < cells.length; i++) {
    if (abortSignal?.aborted) break
    const cell = cells[i]!
    const result = await runVoiceCell({
      role: cell.role,
      modelTag: cell.modelTag,
      prompt: cell.prompt,
      context,
    })
    if (result.ok) {
      records.push(result.record)
    } else {
      validationErrors.push(
        `[${i + 1}/${cells.length}] ${cell.role}@${cell.modelTag}: ${result.validationError}`,
      )
    }
  }

  return {
    type: 'text',
    value: formatSweepResult(records, validationErrors, Date.now() - sweepStart),
  }
}
