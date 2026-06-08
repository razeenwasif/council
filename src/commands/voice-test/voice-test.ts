import { mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { LocalCommandCall } from '../../types/command.js'
import {
  AgentAuthFailureError,
  runSingleAgentFromToolContext,
} from '../../coordinator/council/councilSpawn.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

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
  cap-hit   — model emitted ≥ max_tokens (finish_reason = length, inferred
              when outputTokens ≥ CLAUDE_CODE_MAX_OUTPUT_TOKENS - 5)
  error     — dispatch threw (e.g. agent not found, auth failure, abort)

Example:
  /voice-test empiricist phi4-mini:3.8b-council "name 3 NIST PQC standards"
  /voice-test methodologist gemma4:26b-council "what FTQ count breaks RSA-2048?"
`

const FILE_NAME = 'voice-tests.jsonl'
const OUTPUT_CHAR_CAP = 30_000

type VoiceTestRecord = {
  testId: string
  timestamp: string
  role: string
  modelTag: string
  prompt: string
  status: 'complete' | 'cap-hit' | 'error'
  finishReason: string
  output: string
  outputLen: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  errorMessage?: string
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

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

async function appendVoiceTestRecord(record: VoiceTestRecord): Promise<void> {
  try {
    const dir = getClaudeConfigHomeDir()
    mkdirSync(dir, { recursive: true })
    await appendFile(join(dir, FILE_NAME), JSON.stringify(record) + '\n', 'utf8')
  } catch {
    // best-effort
  }
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
  const { role, modelTag, prompt } = parsed

  // Validate role exists in the agent registry.
  const agentDefs = context.options.agentDefinitions
  const agent = agentDefs?.activeAgents?.find(a => a.agentType === role)
  if (!agent) {
    const known = (agentDefs?.activeAgents ?? []).map(a => a.agentType).sort()
    return {
      type: 'text',
      value:
        `voice-test: unknown role '${role}'. Known roles: ${known.join(', ')}`,
    }
  }

  // Build the providerOverride. 'default' = no override (use agentRouting).
  let providerOverride: { model: string; baseURL: string; apiKey: string } | undefined
  if (modelTag !== 'default') {
    const settings = getInitialSettings()
    const agentModels = (settings as unknown as { agentModels?: Record<string, { base_url?: string; api_key?: string }> }).agentModels
    const entry = agentModels?.[modelTag]
    if (!entry) {
      const known = Object.keys(agentModels ?? {}).sort()
      return {
        type: 'text',
        value:
          `voice-test: model-tag '${modelTag}' not in agentModels. Known tags: ${known.join(', ') || '(none registered)'}\n` +
          `Or use 'default' to skip override and let agentRouting resolve.`,
      }
    }
    if (!entry.base_url || !entry.api_key) {
      return {
        type: 'text',
        value:
          `voice-test: agentModels[${modelTag}] is missing base_url or api_key. Both are required.`,
      }
    }
    providerOverride = {
      model: modelTag,
      baseURL: entry.base_url,
      apiKey: entry.api_key,
    }
  }

  const testId = randomUUID()
  const timestamp = new Date().toISOString()
  const start = Date.now()
  let record: VoiceTestRecord

  try {
    const result = await runSingleAgentFromToolContext({
      subagent_type: role,
      description: `voice-test:${role}@${modelTag}`,
      prompt,
      toolUseContext: context,
      canUseTool: context.canUseTool,
      setMessages: context.setMessages,
      providerOverride,
    })
    const durationMs = Date.now() - start
    const status: 'complete' | 'cap-hit' =
      result.finishReason === 'length' ? 'cap-hit' : 'complete'
    record = {
      testId,
      timestamp,
      role,
      modelTag,
      prompt,
      status,
      finishReason: result.finishReason,
      output: cap(result.text, OUTPUT_CHAR_CAP),
      outputLen: result.text.length,
      durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const errorMessage =
      err instanceof AgentAuthFailureError
        ? `auth failure for ${err.subagentType}: run /login or check OAuth token`
        : err instanceof Error
          ? err.message
          : String(err)
    record = {
      testId,
      timestamp,
      role,
      modelTag,
      prompt,
      status: 'error',
      finishReason: 'error',
      output: '',
      outputLen: 0,
      durationMs,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      errorMessage,
    }
  }

  await appendVoiceTestRecord(record)

  // Compose the one-line summary.
  const durSec = (record.durationMs / 1000).toFixed(1)
  const tokenSummary =
    record.outputTokens > 0 || record.inputTokens > 0
      ? `${record.inputTokens}in/${record.outputTokens}out`
      : '—'
  const headline = `voice-test ${role}@${modelTag}: ${record.status} · ${tokenSummary} · ${durSec}s · testId=${testId.slice(0, 8)}`
  const lines = [headline]
  if (record.errorMessage) {
    lines.push(`  error: ${record.errorMessage}`)
  } else if (record.outputLen > 0) {
    const preview =
      record.outputLen > 200
        ? record.output.slice(0, 200) + '…'
        : record.output
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

  return { type: 'text', value: lines.join('\n') }
}
