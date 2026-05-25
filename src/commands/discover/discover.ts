import { existsSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import type { LocalCommandCall } from '../../types/command.js'
import {
  DebateCostCeilingError,
  DebateMemberFailureError,
  DebateQuorumLostError,
  DebateTimeoutError,
} from '../../coordinator/council/debate.js'
import { runDebateFromToolContext } from '../../coordinator/council/debateSpawn.js'
import {
  AgentAuthFailureError,
} from '../../coordinator/council/councilSpawn.js'
import { defaultBriefPath, writeBrief } from '../../utils/debateBriefWriter.js'

const HELP = `Usage: /discover <question> [--context <path>] [--out <path>]

Runs a multi-round research debate:
  Round 1: 4 researchers (Hypothesizer, Empiricist, Devil's Advocate,
           Methodologist) propose positions IN ISOLATION.
  Round 2: same 4 researchers respond, each seeing the others' R1 positions.
           Output cites position IDs via builds_on / contradicts.
  Round 3: Synthesist produces a structured markdown brief.

Flags:
  --context <path>   Absolute path to a literature review, notes file, or
                     any context the researchers should engage with.
                     Multiple --context flags allowed; each path is
                     passed to all voices and they choose whether to Read
                     it. The Empiricist's prompt mandates citing >=2
                     specific findings, which forces it to engage.

  --out <path>       Write the brief to this absolute path. Default:
                     ~/Research/debates/<YYYY-MM-DD>-<HH-MM>-<slug>.md
                     Use --out=- to skip the file write (brief stays in
                     the transcript only).

Quorum + caps:
  R1 needs >=3 of 4 voices to deliver, R2 needs >=2.
  Cost ceiling: $1.00 (debates are ~5x Council cost — most of it goes to
                the Synthesist's long-context call).
  Member timeout: 5 min per voice per round.

Example:
  /discover "How significant is quantization-induced SNR degradation for
            LIGO/Virgo trigger pipelines at typical detection thresholds?"
            --context ~/Research/lit-review.md`

interface ParsedArgs {
  question: string
  contextFiles: string[]
  outputPath: string | 'stdout-only'
}

/** Parse `<question> [--context <path>]* [--out <path>]`. Question is
 *  everything before the first flag. */
export function parseDiscoverArgs(raw: string): ParsedArgs {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('Question is required. See /discover --help.')
  }

  // Tokenize on whitespace, respecting double-quoted spans.
  const tokens: string[] = []
  let buf = ''
  let inQuote = false
  for (const c of trimmed) {
    if (c === '"') {
      inQuote = !inQuote
      continue
    }
    if (c === ' ' && !inQuote) {
      if (buf) {
        tokens.push(buf)
        buf = ''
      }
      continue
    }
    buf += c
  }
  if (buf) tokens.push(buf)

  // Walk: collect question words until the first --flag, then flags after.
  const questionParts: string[] = []
  const contextFiles: string[] = []
  let outputPath: string | 'stdout-only' | null = null

  let i = 0
  // Phase 1: question (until first --)
  while (i < tokens.length && !tokens[i]!.startsWith('--')) {
    questionParts.push(tokens[i]!)
    i++
  }
  // Phase 2: flags
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok === '--context') {
      const val = tokens[++i]
      if (!val) throw new Error('--context requires a path argument.')
      contextFiles.push(expandPath(val))
    } else if (tok.startsWith('--context=')) {
      contextFiles.push(expandPath(tok.slice('--context='.length)))
    } else if (tok === '--out') {
      const val = tokens[++i]
      if (!val) throw new Error('--out requires a path argument.')
      outputPath = val === '-' ? 'stdout-only' : expandPath(val)
    } else if (tok.startsWith('--out=')) {
      const val = tok.slice('--out='.length)
      outputPath = val === '-' ? 'stdout-only' : expandPath(val)
    } else if (tok === '-h' || tok === '--help') {
      throw new HelpRequestedError()
    } else {
      throw new Error(`Unknown flag: ${tok}. See /discover --help.`)
    }
    i++
  }

  const question = questionParts.join(' ').trim()
  if (!question) {
    throw new Error('Question is required (text before --flags). See /discover --help.')
  }

  return {
    question,
    contextFiles,
    outputPath:
      outputPath ??
      defaultBriefPath(join(homedir(), 'Research', 'debates'), question),
  }
}

class HelpRequestedError extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequestedError'
  }
}

function expandPath(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (p === '~') return homedir()
  if (isAbsolute(p)) return p
  return resolve(process.cwd(), p)
}

export const call: LocalCommandCall = async (args, context) => {
  let parsed: ParsedArgs
  try {
    parsed = parseDiscoverArgs(args)
  } catch (err) {
    if (err instanceof HelpRequestedError) {
      return { type: 'text', value: HELP }
    }
    return {
      type: 'text',
      value: `Argument error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Validate context paths exist before spawning anything.
  const missing = parsed.contextFiles.filter(p => !existsSync(p))
  if (missing.length > 0) {
    return {
      type: 'text',
      value:
        `Context file(s) not found:\n${missing.map(p => `  - ${p}`).join('\n')}\n\n` +
        `Pass an absolute path or one starting with ~/, e.g. --context ~/Research/lit-review.md`,
    }
  }

  try {
    const result = await runDebateFromToolContext({
      question: parsed.question,
      contextFiles: parsed.contextFiles,
      outputPath:
        parsed.outputPath === 'stdout-only' ? undefined : parsed.outputPath,
      toolUseContext: context,
      canUseTool: context.canUseTool,
      setMessages: context.setMessages,
    })

    // Write brief to disk unless --out=- was set.
    let briefPathLine = ''
    if (parsed.outputPath !== 'stdout-only') {
      try {
        const written = writeBrief({
          outputPath: parsed.outputPath,
          result,
        })
        briefPathLine = `\n\nBrief written to: ${written}`
      } catch (err) {
        briefPathLine = `\n\nBrief write failed: ${err instanceof Error ? err.message : String(err)}\n(Brief content is in the transcript above.)`
      }
    }

    const r1 = result.rounds[0]?.positions.length ?? 0
    const r2 = result.rounds[1]?.positions.length ?? 0
    const failures =
      result.failures.length > 0
        ? `\n⚠ ${result.failures.length} voice(s) failed: ${result.failures.map(f => `${f.role} r${f.roundNumber} (${f.isTimeout ? 'timeout' : 'error'})`).join(', ')}`
        : ''

    return {
      type: 'text',
      value:
        `Debate finished — ${r1}/4 r1 positions, ${r2}/4 r2 responses, brief produced.\n` +
        `Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s · Cost: $${result.totalCostUsd.toFixed(4)} (per-session running total in /cost, history in /spend).` +
        failures +
        briefPathLine +
        `\n\n${result.brief}`,
    }
  } catch (err) {
    return { type: 'text', value: formatDebateError(err) }
  }
}

function formatDebateError(err: unknown): string {
  // Unwrap auth failures regardless of wrapper.
  const inner =
    err instanceof DebateMemberFailureError ? err.underlying : err
  if (inner instanceof AgentAuthFailureError) {
    return (
      `Debate failed: authentication error talking to ${inner.subagentType}. ` +
      `Run /login in a standard openclaude session to refresh the OAuth token, then retry.`
    )
  }
  if (err instanceof DebateQuorumLostError) {
    const fails = err.failures
      .map(f => `${f.role} r${f.roundNumber} (${f.isTimeout ? 'timeout' : 'error'})`)
      .join(', ')
    return (
      `Debate quorum lost at ${err.stage} — only ${err.succeededCount}/${err.required} voices delivered. ` +
      `Failed: ${fails}. Check provider status / credentials and retry.`
    )
  }
  if (err instanceof DebateTimeoutError) {
    return `Debate timed out at stage ${err.stage}${err.role ? ` (${err.role})` : ''} after ${err.timeoutMs}ms.`
  }
  if (err instanceof DebateCostCeilingError) {
    return `Debate hit cost ceiling ($${err.ceilingUsd}) at stage "${err.stage}". Accumulated: $${err.accumulatedUsd.toFixed(4)}.`
  }
  if (err instanceof DebateMemberFailureError) {
    const innerMsg =
      err.underlying instanceof Error ? err.underlying.message : String(err.underlying)
    return `Debate member ${err.role} failed in r${err.roundNumber}: ${innerMsg}`
  }
  return `Debate failed: ${err instanceof Error ? err.message : String(err)}`
}
