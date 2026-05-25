/**
 * Format a DebateResult into the on-disk markdown brief.
 *
 * Layout:
 *   1. YAML-ish metadata header (question, date, voices, model bindings,
 *      durations, cost, failures)
 *   2. Position lineage tree — visual map of which R2 positions built on
 *      / contradicted which R1 positions
 *   3. The Synthesist's brief verbatim
 *   4. Appendix: all R1 + R2 positions in full, with position IDs
 */

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { DebateResult, Position, ResearchRole } from '../coordinator/council/debate.js'

export interface WriteBriefOptions {
  /** Absolute output path. Parent directory created if missing. */
  outputPath: string
  result: DebateResult
}

/**
 * Write the brief and return the absolute path. Throws on filesystem
 * error (caller should catch + surface to the user). Mkdir is recursive
 * so users running `/discover` for the first time don't have to
 * pre-create `~/Research/debates/`.
 */
export function writeBrief(opts: WriteBriefOptions): string {
  const content = formatBrief(opts.result)
  mkdirSync(dirname(opts.outputPath), { recursive: true })
  writeFileSync(opts.outputPath, content, 'utf8')
  return opts.outputPath
}

/**
 * Build the markdown content. Pure — exported separately so tests don't
 * need a filesystem.
 */
export function formatBrief(result: DebateResult): string {
  const sections: string[] = [
    formatMetadata(result),
    formatLineageTree(result),
    formatSynthesistSection(result),
    formatAppendix(result),
  ]
  return sections.join('\n\n').trim() + '\n'
}

// ──────────────────────────────────────────────────────────────────────
// Section builders
// ──────────────────────────────────────────────────────────────────────

function formatMetadata(result: DebateResult): string {
  const allPositions = collectAllPositions(result)
  const byRole = new Map<ResearchRole, Position[]>()
  for (const p of allPositions) {
    const existing = byRole.get(p.role) ?? []
    existing.push(p)
    byRole.set(p.role, existing)
  }

  const lines: string[] = []
  lines.push('---')
  lines.push(`question: ${escapeYaml(result.question)}`)
  lines.push(`generated: ${new Date().toISOString()}`)
  lines.push(`duration_sec: ${(result.totalDurationMs / 1000).toFixed(1)}`)
  lines.push(`cost_usd: ${result.totalCostUsd.toFixed(4)}`)
  lines.push(`r1_positions: ${result.rounds[0]?.positions.length ?? 0}`)
  lines.push(`r2_positions: ${result.rounds[1]?.positions.length ?? 0}`)
  lines.push(`failures: ${result.failures.length}`)
  if (byRole.size > 0) {
    lines.push('voices:')
    for (const [role, positions] of byRole) {
      const model = positions[0]?.modelId ?? 'unknown'
      lines.push(`  - role: ${role}`)
      lines.push(`    model: ${model}`)
      lines.push(`    rounds: [${positions.map(p => `r${p.roundNumber}`).join(', ')}]`)
    }
  }
  if (result.failures.length > 0) {
    lines.push('failure_detail:')
    for (const f of result.failures) {
      lines.push(`  - role: ${f.role}`)
      lines.push(`    round: ${f.roundNumber}`)
      lines.push(`    timeout: ${f.isTimeout}`)
      lines.push(`    reason: ${escapeYaml(f.reason)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

function formatLineageTree(result: DebateResult): string {
  const r2 = result.rounds[1]?.positions ?? []
  if (r2.length === 0) {
    return '## Position lineage\n\n_No Round 2 positions._'
  }
  const lines: string[] = ['## Position lineage', '']
  for (const p of r2) {
    lines.push(`- **${p.id}** (${p.role}):`)
    if (p.buildsOn.length > 0) {
      lines.push(`  - builds on: ${p.buildsOn.map(id => `\`${id}\``).join(', ')}`)
    }
    if (p.contradicts.length > 0) {
      lines.push(`  - contradicts: ${p.contradicts.map(id => `\`${id}\``).join(', ')}`)
    }
    if (p.buildsOn.length === 0 && p.contradicts.length === 0) {
      lines.push(`  - _(no explicit lineage cited)_`)
    }
    if (p.confidence !== null) {
      lines.push(`  - confidence: ${p.confidence}/5`)
    }
  }
  return lines.join('\n')
}

function formatSynthesistSection(result: DebateResult): string {
  return result.brief.trim()
}

function formatAppendix(result: DebateResult): string {
  const lines: string[] = ['## Appendix: full positions', '']
  for (const round of result.rounds) {
    lines.push(`### Round ${round.roundNumber}`, '')
    for (const p of round.positions) {
      lines.push(`#### \`${p.id}\` — ${p.role} (${p.modelId})`, '')
      lines.push(p.text.trim(), '')
    }
  }
  return lines.join('\n')
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function collectAllPositions(result: DebateResult): Position[] {
  return result.rounds.flatMap(r => r.positions)
}

/** Defensive YAML string escape — wraps values containing `:` or newlines
 *  in double quotes and escapes inner quotes. Cheap; not RFC-perfect. */
function escapeYaml(s: string): string {
  if (!/[:\n"']/.test(s)) return s
  return `"${s.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/** Build a default output path for the brief.
 *  `<baseDir>/<YYYY-MM-DD>-<HH-MM>-<slug>.md`
 *  The slug is generated from the question, lowercased, hyphen-separated,
 *  truncated to 40 chars. */
export function defaultBriefPath(
  baseDir: string,
  question: string,
  now: Date = new Date(),
): string {
  const date = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 5).replace(':', '-') // HH-MM
  const slug = slugify(question)
  return join(baseDir, `${date}-${time}-${slug}.md`)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '')
    || 'debate'
}
