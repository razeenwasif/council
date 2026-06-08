import type { LocalCommandCall } from '../../types/command.js'
import {
  listKnownRoles,
  listRegisteredModelTags,
  runVoiceCell,
  type VoiceTestRecord,
} from './runCell.js'

const HELP = `Usage: /voice-test <role> <model-tag> "<prompt>"

Runs a single Council/Debate voice in isolation — bypasses the
full /council or /discover pipeline so you can iterate on prompt +
model combinations in 15-30 s instead of 200+ s.

Args:
  <role>       any agentType (e.g. empiricist, methodologist, synthesist,
               architect, skeptic). Validated against the live agent registry.
  <model-tag>  any tag registered in ~/.openclaude/settings.json under
               agentModels, e.g. phi4-mini:3.8b-council. Or literal 'default'
               to use whatever agentRouting resolves for this role.
  "<prompt>"   the test input. Quote it if it has spaces.

Output:
  - one-line summary to the REPL
  - JSONL record appended to ~/.openclaude/voice-tests.jsonl
    (fields: testId, timestamp, role, modelTag, prompt, status,
     finishReason, output, outputLen, durationMs, inputTokens,
     outputTokens, costUsd, errorMessage?)

Status semantics:
  complete  — model finished cleanly (finish_reason = stop)
  cap-hit   — model emitted ≥ max_tokens (finish_reason = length, also
              detected when AgentTool wraps the cap-hit as an error in
              result.text)
  error     — dispatch threw (e.g. agent not found, auth failure, abort)

Tip: to run many (role × model) cells at once, use /voice-sweep instead.

Example:
  /voice-test empiricist phi4-mini:3.8b-council "name 3 NIST PQC standards"
  /voice-test methodologist gemma4:26b-council "what FTQ count breaks RSA-2048?"
`

/**
 * Parse `<role> <model-tag> "<prompt>"`. Prompt may be quoted (with `"…"`)
 * or unquoted (in which case it's everything after the second whitespace).
 */
function parseArgs(raw: string): { role: string; modelTag: string; prompt: string } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { error: 'empty args — see /voice-test help' }
  const m = /^(\S+)\s+(\S+)\s+(.+)$/s.exec(trimmed)
  if (!m) return { error: 'could not parse; need <role> <model-tag> <prompt>' }
  let prompt = m[3]!.trim()
  if (prompt.startsWith('"') && prompt.endsWith('"') && prompt.length >= 2) {
    prompt = prompt.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return { role: m[1]!, modelTag: m[2]!, prompt }
}

function formatCellSummary(record: VoiceTestRecord): string {
  const durSec = (record.durationMs / 1000).toFixed(1)
  const tokenSummary =
    record.outputTokens > 0 || record.inputTokens > 0
      ? `${record.inputTokens}in/${record.outputTokens}out`
      : '—'
  const headline =
    `voice-test ${record.role}@${record.modelTag}: ${record.status} ` +
    `· ${tokenSummary} · ${durSec}s · testId=${record.testId.slice(0, 8)}`
  const lines = [headline]
  if (record.errorMessage) {
    lines.push(`  error: ${record.errorMessage}`)
  } else if (record.outputLen > 0) {
    const preview =
      record.outputLen > 200 ? record.output.slice(0, 200) + '…' : record.output
    lines.push('')
    lines.push('  output preview:')
    lines.push(
      preview
        .split('\n')
        .map(l => '    ' + l)
        .join('\n'),
    )
    if (record.outputLen > 200) {
      lines.push(
        `  (showing first 200/${record.outputLen} chars; full text in voice-tests.jsonl)`,
      )
    }
  }
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args, context) => {
  const raw = (args ?? '').trim()
  if (!raw || raw === 'help' || raw === '-h' || raw === '--help') {
    return { type: 'text', value: HELP }
  }

  const parsed = parseArgs(raw)
  if ('error' in parsed) {
    return { type: 'text', value: `voice-test: ${parsed.error}\n\n${HELP}` }
  }

  const result = await runVoiceCell({
    role: parsed.role,
    modelTag: parsed.modelTag,
    prompt: parsed.prompt,
    context,
  })

  if (!result.ok) {
    // Validation failed (unknown role/model). Surface known options.
    const detail = parsed.modelTag === 'default'
      ? ''
      : `\nKnown model tags: ${listRegisteredModelTags().join(', ') || '(none registered)'}`
    const roleHint = result.validationError.startsWith('unknown role')
      ? `\nKnown roles: ${listKnownRoles(context).join(', ')}`
      : ''
    return {
      type: 'text',
      value: `voice-test: ${result.validationError}${roleHint}${detail}`,
    }
  }

  return { type: 'text', value: formatCellSummary(result.record) }
}
