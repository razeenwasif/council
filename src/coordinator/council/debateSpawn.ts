/**
 * Adapter that wires runDebate() into openclaude's AgentTool dispatch.
 *
 * Mirrors `councilSpawn.ts` for the debate flow:
 *   - `spawnResearcher` invokes the right role agent (hypothesizer / etc.)
 *     with a prompt that includes Round 1 vs Round 2 context appropriately
 *   - `spawnSynthesist` runs the Synthesist with all prior positions
 *     formatted as input
 *   - Panel hooks inject grouped `tool_use` placeholders so the agent
 *     panel renders the same way Council does
 *
 * Reuses `invokeAgentTool`, `buildAgentToolUsePlaceholder`,
 * `buildAgentToolResultMessage`, `applyToolUseIdOverride`, and
 * `resolveRoleModel` from `councilSpawn.ts` — the AgentTool integration
 * patches and panel-render shape are identical between the two flows,
 * so duplicating them would just create drift. If a third flow ever
 * shows up, all of this should move to a shared utility module.
 */

import { randomUUID } from 'crypto'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getTotalCost } from '../../cost-tracker.js'
import {
  applyToolUseIdOverride,
  buildAgentToolResultMessage,
  buildAgentToolUsePlaceholder,
  invokeAgentTool,
  resolveRoleModel,
  type SetMessagesFn,
} from './councilSpawn.js'
import {
  formatPriorPositions,
  makePositionId,
  parseConfidence,
  parseLineage,
  runDebate,
} from './debateOrchestrator.js'
import {
  RESEARCH_ROLES,
  type DebateAdapters,
  type DebateInputs,
  type DebateResult,
  type Position,
  type ResearchRole,
} from './debate.js'
import { emit as emitSessionEvent } from './sessionBus.js'
import { stripThinkBlocks } from '../../utils/stripThinkBlocks.js'

/** Lightweight headline extractor mirroring councilSpawn.quickHeadline. */
function quickHeadline(text: string): string {
  if (!text) return ''
  const m = text.match(/##\s*Headline\s*\n+\s*([^\n]+)/i)
  if (m && m[1]) return m[1].trim().slice(0, 80)
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('#')) continue
    return t.slice(0, 80)
  }
  return ''
}
import {
  ROUND_2_DIRECTIVE,
  ROUND_2_OUTPUT_FORMAT_EXPORTED,
} from '../../tools/AgentTool/built-in/debate/prompts.js'

// ──────────────────────────────────────────────────────────────────────
// Public wrapper — `/discover` calls this
// ──────────────────────────────────────────────────────────────────────

export interface RunDebateFromContextOptions {
  question: string
  contextFiles: string[]
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  emitStatus?: (msg: string) => void
  /** When provided, panel hooks are wired (grouped tool_use placeholders
   *  per round + onProgress propagation). Without it, the orchestrator
   *  runs headless (no UI updates). */
  setMessages?: SetMessagesFn
  costCeilingUsd?: number
  memberTimeoutMs?: number
  synthesistTimeoutMs?: number
  outputPath?: string
}

/** Convenience entry point. Builds the spawn adapters from the given
 *  tool-use context and runs the debate. Returns the structured result
 *  the caller can format / write to disk. Same global-cost snapshot
 *  pattern as `runCouncilFromToolContext` — `totalCostUsd` falls back
 *  to the cost-tracker delta when the per-spawn cost is 0. */
export async function runDebateFromToolContext(
  opts: RunDebateFromContextOptions,
): Promise<DebateResult> {
  const adapters = buildDebateAdapters({
    toolUseContext: opts.toolUseContext,
    canUseTool: opts.canUseTool,
    setMessages: opts.setMessages,
  })

  // Phase B session-view wiring (mirrors councilSpawn). The session view
  // treats discover identically to council in terms of state shape; only
  // the kind tag differs.
  emitSessionEvent({
    type: 'session-start',
    kind: 'discover',
    prompt: opts.question,
    // The full debate voice list includes:
    //   - 4 researchers (hypothesizer / empiricist / devils_advocate / methodologist) for r1 + r2
    //   - 1 synthesist (post-r2 brief writer)
    //   - 1 verifier (post-synthesist fact-checker)
    // All 6 surface in the agent thoughts pane. Synthesist + verifier
    // arrive late in the timeline (after r2 completes) but having them
    // pre-declared in session-start means their cards exist from the
    // beginning, ready to flip to 'running' as each stage fires.
    voices: [
      ...RESEARCH_ROLES.map(role => ({ role, model: resolveRoleModel(role) })),
      { role: 'synthesist', model: resolveRoleModel('synthesist') },
      { role: 'verifier', model: resolveRoleModel('verifier') },
    ],
  })

  const costBefore = getTotalCost()
  try {
    const result = await runDebate({
      question: opts.question,
      contextFiles: opts.contextFiles,
      outputPath: opts.outputPath,
      emitStatus: opts.emitStatus ?? (() => {}),
      costCeilingUsd: opts.costCeilingUsd,
      // Wire the live cost-tracker so the in-orchestrator ledger can
      // enforce the ceiling mid-run. Without this, the per-spawn costUsd
      // (always 0 in the deterministic AgentTool path) would never trip
      // the ceiling, and a runaway debate could quietly bill multiples
      // of the configured cap. See CostLedger docs in debateOrchestrator.ts.
      getCurrentCost: getTotalCost,
      memberTimeoutMs: opts.memberTimeoutMs,
      synthesistTimeoutMs: opts.synthesistTimeoutMs,
      adapters,
    })
    const costAfter = getTotalCost()
    const deltaCost = Math.max(0, costAfter - costBefore)
    return {
      ...result,
      totalCostUsd: result.totalCostUsd > 0 ? result.totalCostUsd : deltaCost,
    }
  } finally {
    emitSessionEvent({ type: 'session-end' })
  }
}

// ──────────────────────────────────────────────────────────────────────
// Adapter factory
// ──────────────────────────────────────────────────────────────────────

export interface BuildDebateAdaptersInputs {
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  setMessages?: SetMessagesFn
}

export function buildDebateAdapters(
  inputs: BuildDebateAdaptersInputs,
): DebateAdapters {
  // Whether we've announced the round-2 / synthesist stage transition.
  // Stage names: round 1 = 'proposal', round 2 = 'revision', synthesist = 'synthesis'.
  let round2Announced = false
  let synthesisAnnounced = false

  return {
    spawnResearcher: async ({
      role,
      roundNumber,
      question,
      contextFiles,
      priorPositions,
      toolUseId,
      signal,
    }) => {
      if (roundNumber === 2 && !round2Announced) {
        round2Announced = true
        emitSessionEvent({ type: 'stage-change', stage: 'revision' })
      }
      emitSessionEvent({ type: 'voice-state', role, status: 'running' })
      try {
        const p = await researcherFromAgentTool({
          role,
          roundNumber,
          question,
          contextFiles,
          priorPositions,
          toolUseId,
          signal,
          toolUseContext: inputs.toolUseContext,
          canUseTool: inputs.canUseTool,
          setMessages: inputs.setMessages,
        })
        emitSessionEvent({ type: 'voice-output', role, chunk: p.text })
        emitSessionEvent({
          type: 'voice-state',
          role,
          status: 'done',
          headline: quickHeadline(p.text),
        })
        return p
      } catch (err) {
        emitSessionEvent({ type: 'voice-state', role, status: 'failed' })
        throw err
      }
    },

    spawnSynthesist: async ({
      question,
      contextFiles,
      allPositions,
      toolUseId,
      signal,
    }) => {
      if (!synthesisAnnounced) {
        synthesisAnnounced = true
        emitSessionEvent({ type: 'stage-change', stage: 'synthesis' })
      }
      return synthesistFromAgentTool({
        question,
        contextFiles,
        allPositions,
        toolUseId,
        signal,
        toolUseContext: inputs.toolUseContext,
        canUseTool: inputs.canUseTool,
        setMessages: inputs.setMessages,
      })
    },

    spawnVerifier: async ({
      question,
      brief,
      allPositions,
      toolUseId,
      signal,
    }) => {
      return verifierFromAgentTool({
        question,
        brief,
        allPositions,
        toolUseId,
        signal,
        toolUseContext: inputs.toolUseContext,
        canUseTool: inputs.canUseTool,
        setMessages: inputs.setMessages,
      })
    },

    ...(inputs.setMessages ? buildDebatePanelHooks(inputs.setMessages) : {}),
  }
}

// ──────────────────────────────────────────────────────────────────────
// Panel hooks (debate-shaped — parallel to Council's buildPanelHooks)
// ──────────────────────────────────────────────────────────────────────

function buildDebatePanelHooks(
  setMessages: SetMessagesFn,
): Pick<DebateAdapters, 'prepareBatch' | 'prepareSingle' | 'completeMember'> {
  return {
    prepareBatch: async ({ kind, roles }) => {
      const messageId = randomUUID()
      const map = new Map<ResearchRole, string>()
      const placeholders: Message[] = []
      for (const role of roles) {
        const toolUseId = randomUUID()
        map.set(role, toolUseId)
        placeholders.push(
          buildAgentToolUsePlaceholder({
            messageId,
            toolUseId,
            subagent_type: role,
            description:
              kind === 'r1'
                ? `${capitalizeResearchRole(role)} r1 position`
                : `${capitalizeResearchRole(role)} r2 response`,
            prompt: `Debate ${kind} for ${role}`,
          }),
        )
      }
      setMessages(prev => [...prev, ...placeholders])
      return map
    },

    prepareSingle: async ({ kind, description }) => {
      const messageId = randomUUID()
      const toolUseId = randomUUID()
      setMessages(prev => [
        ...prev,
        buildAgentToolUsePlaceholder({
          messageId,
          toolUseId,
          subagent_type: kind, // 'synthesist'
          description,
          prompt: `Debate ${kind}`,
        }),
      ])
      return toolUseId
    },

    completeMember: async ({ toolUseId, status, summary }) => {
      setMessages(prev => [
        ...prev,
        buildAgentToolResultMessage({
          toolUseId,
          status,
          summary: summary ?? '',
        }),
      ])
    },
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-stage AgentTool invocations
// ──────────────────────────────────────────────────────────────────────

interface CommonSpawnDeps {
  toolUseContext: ToolUseContext
  canUseTool?: CanUseToolFn
  signal: AbortSignal
  toolUseId?: string
  setMessages?: SetMessagesFn
}

async function researcherFromAgentTool(
  args: {
    role: ResearchRole
    roundNumber: 1 | 2
    question: string
    contextFiles: string[]
    priorPositions: Position[]
  } & CommonSpawnDeps,
): Promise<Position> {
  const start = Date.now()
  const prompt = buildResearcherPrompt({
    role: args.role,
    roundNumber: args.roundNumber,
    question: args.question,
    contextFiles: args.contextFiles,
    priorPositions: args.priorPositions,
  })

  const result = await invokeAgentTool({
    subagent_type: args.role,
    description:
      args.roundNumber === 1
        ? `${capitalizeResearchRole(args.role)} r1 position`
        : `${capitalizeResearchRole(args.role)} r2 response`,
    prompt,
    toolUseContext: applyToolUseIdOverride(
      args.toolUseContext,
      args.toolUseId,
    ),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
  })

  // Strip <think>...</think> blocks (DeepSeek-R1 / Qwen 3 chain-of-thought)
  // before anything downstream sees the text. See utils/stripThinkBlocks.ts
  // for why this happens once here rather than at each consumer.
  const cleanText = stripThinkBlocks(result.text)
  return {
    id: makePositionId(args.roundNumber, args.role),
    role: args.role,
    modelId: resolveRoleModel(args.role),
    roundNumber: args.roundNumber,
    text: cleanText,
    buildsOn: args.roundNumber === 2 ? parseLineage(cleanText, 'builds_on') : [],
    contradicts: args.roundNumber === 2 ? parseLineage(cleanText, 'contradicts') : [],
    confidence: parseConfidence(cleanText),
    durationMs: Date.now() - start,
    costUsd: result.costUsd,
  }
}

async function synthesistFromAgentTool(
  args: {
    question: string
    contextFiles: string[]
    allPositions: Position[]
  } & CommonSpawnDeps,
): Promise<{
  text: string
  modelId: string
  durationMs: number
  costUsd: number
}> {
  const start = Date.now()
  const prompt = buildSynthesistPrompt({
    question: args.question,
    contextFiles: args.contextFiles,
    allPositions: args.allPositions,
  })

  const result = await invokeAgentTool({
    subagent_type: 'synthesist',
    description: 'Synthesize debate brief',
    prompt,
    toolUseContext: applyToolUseIdOverride(
      args.toolUseContext,
      args.toolUseId,
    ),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
  })

  return {
    text: stripThinkBlocks(result.text),
    modelId: resolveRoleModel('synthesist'),
    durationMs: Date.now() - start,
    costUsd: result.costUsd,
  }
}

async function verifierFromAgentTool(
  args: {
    question: string
    brief: string
    allPositions: Position[]
  } & CommonSpawnDeps,
): Promise<{
  text: string
  modelId: string
  durationMs: number
  costUsd: number
}> {
  const start = Date.now()
  // The verifier prompt builds itself from (question + brief + positions).
  // System prompt is the role's static prompt; user prompt is the
  // assembled evidence stack.
  const prompt = buildVerifierPrompt({
    question: args.question,
    brief: args.brief,
    allPositions: args.allPositions,
  })

  const result = await invokeAgentTool({
    subagent_type: 'verifier',
    description: 'Verify synthesist brief',
    prompt,
    toolUseContext: applyToolUseIdOverride(
      args.toolUseContext,
      args.toolUseId,
    ),
    canUseTool: args.canUseTool,
    signal: args.signal,
    parentToolUseId: args.toolUseId,
    setMessages: args.setMessages,
  })

  return {
    text: stripThinkBlocks(result.text),
    modelId: resolveRoleModel('verifier'),
    durationMs: Date.now() - start,
    costUsd: result.costUsd,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Prompt builders — exported for tests
// ──────────────────────────────────────────────────────────────────────

export function buildResearcherPrompt(opts: {
  role: ResearchRole
  roundNumber: 1 | 2
  question: string
  contextFiles: string[]
  priorPositions: Position[]
}): string {
  const contextSection =
    opts.contextFiles.length > 0
      ? `\n\nContext files (read these with your tools if relevant):\n${opts.contextFiles.map(p => `- ${p}`).join('\n')}`
      : ''

  if (opts.roundNumber === 1) {
    return (
      `You are running Round 1 of a debate. Produce your independent position.\n\n` +
      `Research question:\n${opts.question}` +
      contextSection
    )
  }

  // Round 2: include all R1 positions + the special directive
  const formattedPriors = formatPriorPositions(opts.priorPositions)
  return (
    `${ROUND_2_DIRECTIVE}` +
    `Research question:\n${opts.question}\n\n` +
    `Round 1 positions from all researchers:\n\n${formattedPriors}\n\n` +
    `---\n\nYour role in this round: respond. Use the Round 2 output format described below.${contextSection}\n\n` +
    `## Round 2 Output Format\n${ROUND_2_OUTPUT_FORMAT_EXPORTED}`
  )
}

export function buildSynthesistPrompt(opts: {
  question: string
  contextFiles: string[]
  allPositions: Position[]
}): string {
  const formatted = formatPriorPositions(opts.allPositions)
  const contextSection =
    opts.contextFiles.length > 0
      ? `\n\nContext files used by the researchers (for your reference only — do not Read them; you have no tools):\n${opts.contextFiles.map(p => `- ${p}`).join('\n')}`
      : ''

  return (
    `Research question:\n${opts.question}${contextSection}\n\n` +
    `All ${opts.allPositions.length} positions across rounds 1 and 2:\n\n${formatted}\n\n` +
    `---\n\nProduce the structured brief per the format described in your system prompt.`
  )
}

export function buildVerifierPrompt(opts: {
  question: string
  brief: string
  allPositions: Position[]
}): string {
  const formatted = formatPriorPositions(opts.allPositions)
  return (
    `Research question:\n${opts.question}\n\n` +
    `---\n\nThe Synthesist just produced this brief:\n\n${opts.brief}\n\n` +
    `---\n\nThe ${opts.allPositions.length} voice positions that fed into it:\n\n${formatted}\n\n` +
    `---\n\nApply the three flagging lenses described in your system prompt (appendix contradiction / named-entity confabulation / ungrounded specificity). Emit your verification notes per the schema. Stop after the suspect-claims list.`
  )
}

function capitalizeResearchRole(role: ResearchRole): string {
  return role
    .split('_')
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

// Re-exports for the slash command + tests.
export { runDebate }
export type { DebateAdapters, DebateInputs, DebateResult, Position, ResearchRole }
