/**
 * Per-cell execution shared by /voice-test (one cell) and /voice-sweep
 * (many cells). Resolves the agent definition + providerOverride from
 * settings, fires runSingleAgentFromToolContext, builds the JSONL
 * record (including cap-hit detection), appends to voice-tests.jsonl.
 *
 * Keeping this in one place means failure-mode classification + JSONL
 * schema stay consistent across both commands. If voice-test grows a
 * new diagnostic field, voice-sweep gets it automatically.
 */

import { mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
  AgentAuthFailureError,
  runSingleAgentFromToolContext,
} from '../../coordinator/council/councilSpawn.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { ToolUseContext } from '../../Tool.js'
import type { CanUseToolFn, SetMessagesFn } from '../../coordinator/council/councilSpawn.js'

export const VOICE_TESTS_FILENAME = 'voice-tests.jsonl'
export const VOICE_TEST_OUTPUT_CHAR_CAP = 30_000

export type VoiceTestStatus = 'complete' | 'cap-hit' | 'error'

export type VoiceTestRecord = {
  testId: string
  timestamp: string
  role: string
  modelTag: string
  prompt: string
  status: VoiceTestStatus
  finishReason: string
  output: string
  outputLen: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  errorMessage?: string
}

export interface RunVoiceCellArgs {
  role: string
  /** A registered agentModels tag (e.g. "mathstral:7b-council") or the literal "default". */
  modelTag: string
  prompt: string
  context: ToolUseContext & {
    canUseTool?: CanUseToolFn
    setMessages?: SetMessagesFn
  }
}

export type RunVoiceCellResult =
  | { ok: true; record: VoiceTestRecord }
  | { ok: false; validationError: string }

function cap(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

async function appendVoiceTestRecord(record: VoiceTestRecord): Promise<void> {
  try {
    const dir = getClaudeConfigHomeDir()
    mkdirSync(dir, { recursive: true })
    await appendFile(
      join(dir, VOICE_TESTS_FILENAME),
      JSON.stringify(record) + '\n',
      'utf8',
    )
  } catch {
    // best-effort: don't block the sweep on a disk error
  }
}

/**
 * List known role names from the active agent registry — used by the
 * sweep planner + the error path of voice-test to surface known roles
 * back to the user.
 */
export function listKnownRoles(
  context: ToolUseContext,
): string[] {
  const agentDefs = context.options.agentDefinitions
  return (agentDefs?.activeAgents ?? []).map(a => a.agentType).sort()
}

/**
 * Read the registered model tags from ~/.openclaude/settings.json
 * agentModels block. Returns [] if the block is missing.
 */
export function listRegisteredModelTags(): string[] {
  const settings = getInitialSettings()
  const agentModels = (settings as unknown as {
    agentModels?: Record<string, unknown>
  }).agentModels
  return Object.keys(agentModels ?? {}).sort()
}

/**
 * Run one (role, model, prompt) cell. Validates the role + model,
 * fires the agent, appends the JSONL record, returns the record. Use
 * either from /voice-test (one call) or /voice-sweep (looped). All
 * failure modes (auth, abort, cap-hit, error) are normalized into the
 * returned record's status field; the function does not throw on agent
 * failure — only on caller-error (unknown role, missing model config).
 */
export async function runVoiceCell(
  args: RunVoiceCellArgs,
): Promise<RunVoiceCellResult> {
  const { role, modelTag, prompt, context } = args

  // Validate role exists in the agent registry.
  const agentDefs = context.options.agentDefinitions
  const agent = agentDefs?.activeAgents?.find(a => a.agentType === role)
  if (!agent) {
    const known = listKnownRoles(context).join(', ')
    return {
      ok: false,
      validationError: `unknown role '${role}'. Known roles: ${known}`,
    }
  }

  // Resolve providerOverride. 'default' = no override.
  let providerOverride: { model: string; baseURL: string; apiKey: string } | undefined
  if (modelTag !== 'default') {
    const settings = getInitialSettings()
    const agentModels = (settings as unknown as {
      agentModels?: Record<string, { base_url?: string; api_key?: string }>
    }).agentModels
    const entry = agentModels?.[modelTag]
    if (!entry) {
      const known = Object.keys(agentModels ?? {}).sort().join(', ') || '(none registered)'
      return {
        ok: false,
        validationError: `model-tag '${modelTag}' not in agentModels. Known: ${known}`,
      }
    }
    if (!entry.base_url || !entry.api_key) {
      return {
        ok: false,
        validationError: `agentModels[${modelTag}] missing base_url or api_key`,
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

    // Cap-hit detection — see voice-test.ts comment block for the
    // double-heuristic rationale: (a) finishReason='length' from the
    // invokeAgentTool layer, (b) pattern-match the API-error wording
    // that AgentTool wraps cap-hits into when content consolidation
    // short-circuits and outputTokens registers as 0.
    const capHitErrorPattern = /response exceeded the \d+ output token maximum/i
    const reachedContextWindow =
      /model has reached its context window limit/i.test(result.text)
    const isCapHitText =
      capHitErrorPattern.test(result.text) || reachedContextWindow
    const isCapHit = result.finishReason === 'length' || isCapHitText
    const status: VoiceTestStatus = isCapHit ? 'cap-hit' : 'complete'
    const finishReason = isCapHit ? 'length' : result.finishReason

    record = {
      testId,
      timestamp,
      role,
      modelTag,
      prompt,
      status,
      finishReason,
      output: cap(result.text, VOICE_TEST_OUTPUT_CHAR_CAP),
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
  return { ok: true, record }
}
