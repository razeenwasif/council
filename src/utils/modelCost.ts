import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'
import { setHasUnknownModelCost } from '../bootstrap/state.js'
import { isFastModeEnabled } from './fastMode.js'
import {
  CLAUDE_3_5_HAIKU_CONFIG,
  CLAUDE_3_5_V2_SONNET_CONFIG,
  CLAUDE_3_7_SONNET_CONFIG,
  CLAUDE_HAIKU_4_5_CONFIG,
  CLAUDE_OPUS_4_1_CONFIG,
  CLAUDE_OPUS_4_5_CONFIG,
  CLAUDE_OPUS_4_6_CONFIG,
  CLAUDE_OPUS_4_7_CONFIG,
  CLAUDE_OPUS_4_CONFIG,
  CLAUDE_SONNET_4_5_CONFIG,
  CLAUDE_SONNET_4_6_CONFIG,
  CLAUDE_SONNET_4_CONFIG,
} from './model/configs.js'
import {
  firstPartyNameToCanonical,
  getCanonicalName,
  getDefaultMainLoopModelSetting,
  type ModelShortName,
} from './model/model.js'

// @see https://platform.claude.com/docs/en/about-claude/pricing
export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

// Standard pricing tier for Sonnet models: $3 input / $15 output per Mtok
export const COST_TIER_3_15 = {
  inputTokens: 3,
  outputTokens: 15,
  promptCacheWriteTokens: 3.75,
  promptCacheReadTokens: 0.3,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Opus 4/4.1: $15 input / $75 output per Mtok
export const COST_TIER_15_75 = {
  inputTokens: 15,
  outputTokens: 75,
  promptCacheWriteTokens: 18.75,
  promptCacheReadTokens: 1.5,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing tier for Opus 4.5: $5 input / $25 output per Mtok
export const COST_TIER_5_25 = {
  inputTokens: 5,
  outputTokens: 25,
  promptCacheWriteTokens: 6.25,
  promptCacheReadTokens: 0.5,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Fast mode pricing for Opus 4.6: $30 input / $150 output per Mtok
export const COST_TIER_30_150 = {
  inputTokens: 30,
  outputTokens: 150,
  promptCacheWriteTokens: 37.5,
  promptCacheReadTokens: 3,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing for Haiku 3.5: $0.80 input / $4 output per Mtok
export const COST_HAIKU_35 = {
  inputTokens: 0.8,
  outputTokens: 4,
  promptCacheWriteTokens: 1,
  promptCacheReadTokens: 0.08,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Pricing for Haiku 4.5: $1 input / $5 output per Mtok
export const COST_HAIKU_45 = {
  inputTokens: 1,
  outputTokens: 5,
  promptCacheWriteTokens: 1.25,
  promptCacheReadTokens: 0.1,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

const DEFAULT_UNKNOWN_MODEL_COST = COST_TIER_5_25

// Zero-cost tier for local Ollama / self-hosted models. Any model name
// ending in `-council` (the Council fork's Modelfile naming convention
// for tuned local models, e.g. `mathstral:7b-council`) gets this tier —
// local inference has no per-token API cost.
const COST_ZERO_LOCAL: ModelCosts = {
  inputTokens: 0,
  outputTokens: 0,
  promptCacheWriteTokens: 0,
  promptCacheReadTokens: 0,
  webSearchRequests: 0,
}

/**
 * Pricing entries for OpenAI-compatible shim providers used as Council
 * agent backends via the `agentModels` / `providerOverride` plumbing.
 *
 * Keyed by the raw model name the shim sees (NOT the Claude
 * canonical name), so this map sits in front of the canonical-name
 * `MODEL_COSTS` lookup in `getModelCosts`.
 *
 * Prices verified 2026-06-09 from public provider pricing pages
 * (per-million-token rates). Adjust when provider pricing changes.
 *
 * Without these entries, every shim-provider call falls back to the
 * default Opus-tier costs, inflating `/spend --models` rows for cheap
 * providers by 50-100×.
 */
const SHIM_PROVIDER_COSTS: Record<string, ModelCosts> = {
  // DeepSeek (deepseek.com pricing, cache-discounted reads)
  'deepseek-chat': {
    inputTokens: 0.27,
    outputTokens: 1.10,
    promptCacheWriteTokens: 0.27,
    promptCacheReadTokens: 0.07,
    webSearchRequests: 0,
  },
  'deepseek-reasoner': {
    inputTokens: 0.55,
    outputTokens: 2.19,
    promptCacheWriteTokens: 0.55,
    promptCacheReadTokens: 0.14,
    webSearchRequests: 0,
  },
  // Google Gemini (aistudio.google.com pricing — paid tier)
  'gemini-3.5-flash': {
    inputTokens: 0.30,
    outputTokens: 2.50,
    promptCacheWriteTokens: 0.30,
    promptCacheReadTokens: 0.075,
    webSearchRequests: 0,
  },
  'gemini-3.5-pro': {
    inputTokens: 1.25,
    outputTokens: 10.0,
    promptCacheWriteTokens: 1.25,
    promptCacheReadTokens: 0.31,
    webSearchRequests: 0,
  },
  // Alibaba Qwen (DashScope international pricing)
  'qwen3.6-plus': {
    inputTokens: 0.40,
    outputTokens: 1.20,
    promptCacheWriteTokens: 0.40,
    promptCacheReadTokens: 0.10,
    webSearchRequests: 0,
  },
  // Mistral AI
  'mistral-large-latest': {
    inputTokens: 2.0,
    outputTokens: 6.0,
    promptCacheWriteTokens: 2.0,
    promptCacheReadTokens: 0.50,
    webSearchRequests: 0,
  },
  'mistral-medium-latest': {
    inputTokens: 0.40,
    outputTokens: 2.0,
    promptCacheWriteTokens: 0.40,
    promptCacheReadTokens: 0.10,
    webSearchRequests: 0,
  },
  // OpenAI (platform.openai.com pricing)
  'gpt-4.1-mini': {
    inputTokens: 0.40,
    outputTokens: 1.60,
    promptCacheWriteTokens: 0.40,
    promptCacheReadTokens: 0.10,
    webSearchRequests: 0,
  },
  'gpt-4o-mini': {
    inputTokens: 0.15,
    outputTokens: 0.60,
    promptCacheWriteTokens: 0.15,
    promptCacheReadTokens: 0.075,
    webSearchRequests: 0,
  },
}

/**
 * Get the cost tier for Opus 4.6 based on fast mode.
 */
export function getOpus46CostTier(fastMode: boolean): ModelCosts {
  if (isFastModeEnabled() && fastMode) {
    return COST_TIER_30_150
  }
  return COST_TIER_5_25
}

// @[MODEL LAUNCH]: Add a pricing entry for the new model below.
// Costs from https://platform.claude.com/docs/en/about-claude/pricing
// Web search cost: $10 per 1000 requests = $0.01 per request
export const MODEL_COSTS: Record<ModelShortName, ModelCosts> = {
  [firstPartyNameToCanonical(CLAUDE_3_5_HAIKU_CONFIG.firstParty)]:
    COST_HAIKU_35,
  [firstPartyNameToCanonical(CLAUDE_HAIKU_4_5_CONFIG.firstParty)]:
    COST_HAIKU_45,
  [firstPartyNameToCanonical(CLAUDE_3_5_V2_SONNET_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_3_7_SONNET_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_5_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_6_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_CONFIG.firstParty)]: COST_TIER_15_75,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_1_CONFIG.firstParty)]:
    COST_TIER_15_75,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_5_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_7_CONFIG.firstParty)]:
    COST_TIER_5_25,
}

/**
 * Calculates the USD cost based on token usage and model cost configuration
 */
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
    (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheReadTokens +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheWriteTokens +
    (usage.server_tool_use?.web_search_requests ?? 0) *
      modelCosts.webSearchRequests
  )
}

export function getModelCosts(model: string, usage: Usage): ModelCosts {
  // 1. Local Ollama / self-hosted models — by Council Modelfile
  //    convention these end in `-council` (e.g. `mathstral:7b-council`).
  //    Local inference has no per-token API cost.
  if (model.endsWith('-council')) {
    return COST_ZERO_LOCAL
  }

  // 2. Shim provider passthrough — look up by raw model name BEFORE
  //    canonical-name normalization, because shim providers use names
  //    Anthropic's canonical-name resolver doesn't recognize.
  const shimCosts = SHIM_PROVIDER_COSTS[model]
  if (shimCosts) return shimCosts

  const shortName = getCanonicalName(model)

  // 3. Opus 4.6 special case (fast-mode tier switch).
  if (
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty)
  ) {
    const isFastMode = usage.speed === 'fast'
    return getOpus46CostTier(isFastMode)
  }

  // 4. Canonical Claude model pricing.
  const costs = MODEL_COSTS[shortName]
  if (!costs) {
    trackUnknownModelCost(model, shortName)
    return (
      MODEL_COSTS[getCanonicalName(getDefaultMainLoopModelSetting())] ??
      DEFAULT_UNKNOWN_MODEL_COST
    )
  }
  return costs
}

function trackUnknownModelCost(model: string, shortName: ModelShortName): void {
  logEvent('tengu_unknown_model_cost', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    shortName:
      shortName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  setHasUnknownModelCost()
}

// Calculate the cost of a query in US dollars.
// If the model's costs are not found, use the default model's costs.
export function calculateUSDCost(resolvedModel: string, usage: Usage): number {
  const modelCosts = getModelCosts(resolvedModel, usage)
  return tokensToUSDCost(modelCosts, usage)
}

/**
 * Calculate cost from raw token counts without requiring a full BetaUsage object.
 * Useful for side queries (e.g. classifier) that track token counts independently.
 */
export function calculateCostFromTokens(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  },
): number {
  const usage: Usage = {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cache_read_input_tokens: tokens.cacheReadInputTokens,
    cache_creation_input_tokens: tokens.cacheCreationInputTokens,
  } as Usage
  return calculateUSDCost(model, usage)
}

function formatPrice(price: number): string {
  // Format price: integers without decimals, others with 2 decimal places
  // e.g., 3 -> "$3", 0.8 -> "$0.80", 22.5 -> "$22.50"
  if (Number.isInteger(price)) {
    return `$${price}`
  }
  return `$${price.toFixed(2)}`
}

/**
 * Format model costs as a pricing string for display
 * e.g., "$3/$15 per Mtok"
 */
export function formatModelPricing(costs: ModelCosts): string {
  return `${formatPrice(costs.inputTokens)}/${formatPrice(costs.outputTokens)} per Mtok`
}

/**
 * Get formatted pricing string for a model
 * Accepts either a short name or full model name
 * Returns undefined if model is not found
 */
export function getModelPricingString(model: string): string | undefined {
  const shortName = getCanonicalName(model)
  const costs = MODEL_COSTS[shortName]
  if (!costs) return undefined
  return formatModelPricing(costs)
}
