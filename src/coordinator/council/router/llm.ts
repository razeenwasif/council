import type { RouterDecision } from './strategy.js'
import { decideHeuristic } from './heuristic.js'
import { getSettings_DEPRECATED } from '../../../utils/settings/settings.js'

/**
 * LLM-based router classifier. One cheap call to a small/fast model
 * (default: gemini-3.5-flash) returns either "solo" or "council" and the
 * router routes the user prompt accordingly. Falls back to the heuristic
 * on any failure — network blip, model unreachable, unparseable response,
 * settings missing, timeout. The router must never block on a hiccup.
 *
 * Provider lookup chain:
 *   1. settings.agentRouting.classifier → settings.agentModels[that value]
 *   2. settings.agentModels[CLASSIFIER_MODEL_DEFAULT]
 *   3. heuristic fallback (classify() returns 'unwired')
 *
 * Why DI fetcher: keeps the unit tests free of globalThis.fetch monkeypatch.
 * Production callers omit the fetcher arg and get the real fetch.
 */

export const CLASSIFIER_MODEL_DEFAULT = 'gemini-3.5-flash'

const CLASSIFIER_SYSTEM_PROMPT = `You are a router. Classify each user request as either:

- "solo": small enough that one agent can handle it cleanly — renames, formatting/lint, simple file reads, single-line edits, explanations of existing code, trivial dependency bumps.
- "council": warrants a seven-way design review before code changes — new features, multi-file refactors, design decisions, anything touching user input / secrets / network, anything ambiguous.

Output exactly one word: solo or council. No explanation, no quotes, no punctuation.`

const CLASSIFIER_TIMEOUT_MS_DEFAULT = 4_000
const CLASSIFIER_MAX_TOKENS = 8 // "council" is one token in most tokenizers

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type ClassifierOutput = 'solo' | 'council' | 'unwired' | 'unparseable'

export type Fetcher = typeof fetch

export interface ClassifyOptions {
  fetcher?: Fetcher
  timeoutMs?: number
  /** Pre-loaded settings — tests inject these so they don't depend on
   *  the real ~/.openclaude/settings.json on disk. */
  settings?: {
    agentModels?: Record<string, { base_url?: string; api_key?: string }>
    agentRouting?: Record<string, string>
  }
}

interface ResolvedProfile {
  modelName: string
  baseUrl: string
  apiKey: string
}

// ──────────────────────────────────────────────────────────────────────
// Profile resolution
// ──────────────────────────────────────────────────────────────────────

function resolveClassifierProfile(
  override?: ClassifyOptions['settings'],
): ResolvedProfile | null {
  const settings =
    override ??
    ((getSettings_DEPRECATED() ?? {}) as NonNullable<ClassifyOptions['settings']>)

  const models = settings?.agentModels ?? {}
  const routing = settings?.agentRouting ?? {}

  // Look for an explicit `classifier` route; otherwise fall back to the
  // default model name (`gemini-3.5-flash`).
  const candidate = routing['classifier'] ?? CLASSIFIER_MODEL_DEFAULT
  const entry = models[candidate]
  if (!entry?.base_url || !entry?.api_key) return null

  return {
    modelName: candidate,
    baseUrl: entry.base_url.replace(/\/+$/, ''), // strip trailing slash
    apiKey: entry.api_key,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Classifier call
// ──────────────────────────────────────────────────────────────────────

export async function classify(
  prompt: string,
  opts: ClassifyOptions = {},
): Promise<ClassifierOutput> {
  const profile = resolveClassifierProfile(opts.settings)
  if (!profile) return 'unwired'

  const fetcher = opts.fetcher ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? CLASSIFIER_TIMEOUT_MS_DEFAULT

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  try {
    const res = await fetcher(`${profile.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model: profile.modelName,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: CLASSIFIER_MAX_TOKENS,
        temperature: 0,
      }),
      signal: ac.signal,
    })

    if (!res.ok) return 'unparseable'

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data?.choices?.[0]?.message?.content?.trim().toLowerCase() ?? ''
    return normalizeClassifierOutput(raw)
  } catch {
    // Timeout or network error — caller falls back to heuristic.
    return 'unparseable'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Normalize a raw classifier response to one of the canonical outputs.
 * Tolerates surrounding whitespace, quotes, punctuation, and common
 * preambles ("decision: solo"). Rejects ambiguous responses where both
 * "solo" and "council" appear — the model is supposed to pick one.
 */
export function normalizeClassifierOutput(raw: string): ClassifierOutput {
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)

  const hasSolo = tokens.includes('solo')
  const hasCouncil = tokens.includes('council')

  // Ambiguous → reject; the model failed to follow "exactly one word".
  if (hasSolo && hasCouncil) return 'unparseable'
  if (hasSolo) return 'solo'
  if (hasCouncil) return 'council'
  return 'unparseable'
}

// ──────────────────────────────────────────────────────────────────────
// Strategy entry point — what strategy.ts dispatches into
// ──────────────────────────────────────────────────────────────────────

export async function decideLLM(
  prompt: string,
  opts: ClassifyOptions = {},
): Promise<RouterDecision> {
  const result = await classify(prompt, opts)

  if (result === 'solo') {
    return {
      route: 'solo',
      reason: `classifier (${CLASSIFIER_MODEL_DEFAULT}) → solo`,
    }
  }
  if (result === 'council') {
    return {
      route: 'council',
      reason: `classifier (${CLASSIFIER_MODEL_DEFAULT}) → council`,
    }
  }

  // 'unwired' or 'unparseable' — fall back to the deterministic heuristic.
  const fallback = decideHeuristic(prompt)
  return {
    ...fallback,
    reason: `classifier ${result} — fell back to heuristic: ${fallback.reason}`,
  }
}
