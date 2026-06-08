import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getMostRecentRun,
  readAllRuns,
  updateRun,
  type OutcomeLabel,
  type VerificationVerdict,
} from '../../utils/councilTelemetry.js'

const HELP =
  'Usage:\n' +
  '  /verdict outcome <label> [notes]\n' +
  '      label: accept | reject | partial | manual\n' +
  '      sets outcome on the most recent council/discover run\n' +
  '  /verdict verify <verdict> <notes>\n' +
  '      verdict: correct | partial | incorrect\n' +
  '      appends a verification (your judgment after Claude critiqued the brief, etc.)\n' +
  '  /verdict list [N]\n' +
  '      list last N runs (default 5) with outcome + verification counts\n' +
  '  /verdict help\n' +
  '      this message'

const OUTCOME_MAP: Record<string, OutcomeLabel> = {
  accept: 'accepted',
  accepted: 'accepted',
  reject: 'rejected',
  rejected: 'rejected',
  partial: 'partial',
  manual: 'needed-manual-fix',
  fix: 'needed-manual-fix',
}

const VERDICT_MAP: Record<string, VerificationVerdict> = {
  correct: 'correct',
  partial: 'partial',
  incorrect: 'incorrect',
  wrong: 'incorrect',
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const raw = (args ?? '').trim()
  if (!raw || raw === 'help' || raw === '--help' || raw === '-h') {
    onDone(HELP, { display: 'system' })
    return null
  }

  const parts = raw.split(/\s+/)
  const sub = parts[0]

  if (sub === 'list') {
    const limit = Math.max(1, parseInt(parts[1] ?? '5', 10) || 5)
    const runs = await readAllRuns()
    if (runs.length === 0) {
      onDone('No council runs logged yet.', { display: 'system' })
      return null
    }
    const tail = runs.slice(-limit).reverse()
    const lines = tail.map(r => {
      const time = r.timestamp.slice(0, 19).replace('T', ' ')
      const outcome = r.outcome?.label ?? '—'
      const verifs = r.verifications?.length ?? 0
      const promptPreview =
        r.prompt.length > 60 ? r.prompt.slice(0, 60) + '…' : r.prompt
      const dur = r.totalDurationMs
        ? `${(r.totalDurationMs / 1000).toFixed(1)}s`
        : '—'
      return `${time} · ${r.kind} · ${dur} · outcome:${outcome} · verifs:${verifs}\n  ${r.runId.slice(0, 8)}  ${promptPreview}`
    })
    onDone(
      `Recent council runs (${tail.length} of ${runs.length} total):\n\n` +
        lines.join('\n\n'),
      { display: 'system' },
    )
    return null
  }

  if (sub === 'outcome') {
    const labelArg = parts[1]
    if (!labelArg) {
      onDone('Usage: /verdict outcome <accept|reject|partial|manual> [notes]', {
        display: 'system',
      })
      return null
    }
    const label = OUTCOME_MAP[labelArg.toLowerCase()]
    if (!label) {
      onDone(
        `Unknown outcome '${labelArg}'. Use: accept | reject | partial | manual`,
        { display: 'system' },
      )
      return null
    }
    const notes = parts.slice(2).join(' ').trim() || undefined
    const recent = await getMostRecentRun()
    if (!recent) {
      onDone('No recent council run to attach outcome to.', { display: 'system' })
      return null
    }
    const ok = await updateRun(recent.runId, r => ({
      ...r,
      outcome: {
        label,
        setAt: new Date().toISOString(),
        notes,
      },
    }))
    if (!ok) {
      onDone(`Couldn't update run ${recent.runId.slice(0, 8)}.`, {
        display: 'system',
      })
      return null
    }
    onDone(
      `Outcome '${label}' recorded on run ${recent.runId.slice(0, 8)}.${notes ? ` (${notes})` : ''}`,
      { display: 'system' },
    )
    return null
  }

  if (sub === 'verify') {
    const verdictArg = parts[1]
    if (!verdictArg) {
      onDone('Usage: /verdict verify <correct|partial|incorrect> <notes>', {
        display: 'system',
      })
      return null
    }
    const verdict = VERDICT_MAP[verdictArg.toLowerCase()]
    if (!verdict) {
      onDone(
        `Unknown verdict '${verdictArg}'. Use: correct | partial | incorrect`,
        { display: 'system' },
      )
      return null
    }
    const notes = parts.slice(2).join(' ').trim()
    if (!notes) {
      onDone(
        'Verification notes are required (so the verdict means something later).\nUsage: /verdict verify <correct|partial|incorrect> <notes>',
        { display: 'system' },
      )
      return null
    }
    const recent = await getMostRecentRun()
    if (!recent) {
      onDone('No recent council run to attach verification to.', {
        display: 'system',
      })
      return null
    }
    const ok = await updateRun(recent.runId, r => ({
      ...r,
      verifications: [
        ...(r.verifications ?? []),
        {
          verifier: 'human',
          timestamp: new Date().toISOString(),
          verdict,
          notes,
        },
      ],
    }))
    if (!ok) {
      onDone(`Couldn't update run ${recent.runId.slice(0, 8)}.`, {
        display: 'system',
      })
      return null
    }
    onDone(
      `Verification (${verdict}) recorded on run ${recent.runId.slice(0, 8)}.`,
      { display: 'system' },
    )
    return null
  }

  onDone(`Unknown subcommand '${sub}'.\n\n${HELP}`, { display: 'system' })
  return null
}
