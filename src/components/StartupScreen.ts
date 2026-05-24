/**
 * Council startup screen — filled-block text logo with sunset gradient.
 * Called once at CLI startup before the Ink UI renders.
 *
 * Addresses: https://github.com/Gitlawb/openclaude/issues/55
 */

import { isLocalProviderUrl, resolveProviderRequest } from '../services/api/providerConfig.js'
import {
  getRouteLabel,
  resolveRouteIdFromBaseUrl,
} from '../integrations/routeMetadata.js'
import { getLocalOpenAICompatibleProviderLabel } from '../utils/providerDiscovery.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { parseUserSpecifiedModel } from '../utils/model/model.js'
import { DEFAULT_GEMINI_MODEL } from '../utils/providerProfile.js'
import { getGlobalConfig } from '../utils/config.js'
import { ANSI_DIM, ANSI_RESET, ansiRgb } from '../utils/terminalAnsi.js'
import {
  resolveLogoPalette,
  type RGB,
} from './StartupScreen.palettes.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const RESET = ANSI_RESET
const DIM = ANSI_DIM

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradAt(stops: readonly RGB[], t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  const s = c * (stops.length - 1)
  const i = Math.floor(s)
  if (i >= stops.length - 1) return stops[stops.length - 1]
  return lerp(stops[i], stops[i + 1], s - i)
}

export function paintLine(text: string, stops: readonly RGB[], lineT: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? lineT * 0.5 + (i / (text.length - 1)) * 0.5 : lineT
    const [r, g, b] = gradAt(stops, t)
    out += `${ansiRgb(r, g, b)}${text[i]}`
  }
  return out + RESET
}

// ─── Filled Block Text Logo ───────────────────────────────────────────────────

// Logo = [mark] [gap] [wordmark]. The mark depicts four voices (corner \u25cf)
// converging into one center diamond (\u25c6) \u2014 the council story in 5\u00d75. The
// wordmark spells COUNCIL in plain pixel-block letters with no box-drawing
// corner-detail, keeping it visually distinct from the upstream OpenClaude /
// Claude Code banner. Both pieces are gradient-painted together.

const LOGO_MARK = [
  `\u25cf   \u25cf`,
  ` \u2572 \u2571 `,
  `  \u25c6  `,
  ` \u2571 \u2572 `,
  `\u25cf   \u25cf`,
]

// Double-stroke pixel-block letters: 6 cols per letter, 5 rows tall, with
// 2-wide vertical members for a bolder feel. Single-space gap between letters.
const LOGO_WORDMARK = [
  `\u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588  \u2588\u2588 \u2588\u2588  \u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588    `,
  `\u2588\u2588     \u2588\u2588  \u2588\u2588 \u2588\u2588  \u2588\u2588 \u2588\u2588\u2588 \u2588\u2588 \u2588\u2588       \u2588\u2588   \u2588\u2588    `,
  `\u2588\u2588     \u2588\u2588  \u2588\u2588 \u2588\u2588  \u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588       \u2588\u2588   \u2588\u2588    `,
  `\u2588\u2588     \u2588\u2588  \u2588\u2588 \u2588\u2588  \u2588\u2588 \u2588\u2588 \u2588\u2588\u2588 \u2588\u2588       \u2588\u2588   \u2588\u2588    `,
  `\u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588  \u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588`,
]

const LOGO_GAP = '   ' // 3 spaces between mark and wordmark

const LOGO_COUNCIL = LOGO_MARK.map(
  (mark, i) => `  ${mark}${LOGO_GAP}${LOGO_WORDMARK[i]}`,
)

// ─── Provider detection ───────────────────────────────────────────────────────

export function detectProvider(modelOverride?: string): { name: string; model: string; baseUrl: string; isLocal: boolean } {
  const useGemini = process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true'
  const useGithub = process.env.CLAUDE_CODE_USE_GITHUB === '1' || process.env.CLAUDE_CODE_USE_GITHUB === 'true'
  const useOpenAI = process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true'
  const useMistral = process.env.CLAUDE_CODE_USE_MISTRAL === '1' || process.env.CLAUDE_CODE_USE_MISTRAL === 'true'

  if (useGemini) {
    const model = modelOverride || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
    return { name: 'Google Gemini', model, baseUrl, isLocal: false }
  }

  if (useMistral) {
    const model = modelOverride || process.env.MISTRAL_MODEL || 'devstral-latest'
    const baseUrl = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1'
    return { name: 'Mistral', model, baseUrl, isLocal: false }
  }

  if (useGithub) {
    const model = modelOverride || process.env.OPENAI_MODEL || 'github:copilot'
    const baseUrl =
      process.env.OPENAI_BASE_URL || 'https://api.githubcopilot.com'
    return { name: 'GitHub Copilot', model, baseUrl, isLocal: false }
  }

  if (useOpenAI) {
    const rawModel = modelOverride || process.env.OPENAI_MODEL || 'gpt-4o'
    const resolvedRequest = resolveProviderRequest({
      model: rawModel,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    const baseUrl = resolvedRequest.baseUrl
    const isLocal = isLocalProviderUrl(baseUrl)
    const routeId = resolveRouteIdFromBaseUrl(baseUrl)
    let name = 'OpenAI'
    // Explicit dedicated-provider env flags win.
    if (process.env.NVIDIA_NIM) name = 'NVIDIA NIM'
    else if (process.env.MINIMAX_API_KEY) name = 'MiniMax'
    else if (
      resolvedRequest.transport === 'codex_responses' ||
      baseUrl.includes('chatgpt.com/backend-api/codex')
    )
      name = 'Codex'
    // Base URL is authoritative — must precede rawModel checks so aggregators
    // (OpenRouter/Together/Groq) aren't mislabelled as DeepSeek/Kimi/etc.
    // when routed to models whose IDs contain a vendor prefix. See issue #855.
    else if (/openrouter/i.test(baseUrl)) name = 'OpenRouter'
    else if (/together/i.test(baseUrl)) name = 'Together AI'
    else if (/groq/i.test(baseUrl)) name = 'Groq'
    else if (/azure/i.test(baseUrl)) name = 'Azure OpenAI'
    else if (/nvidia/i.test(baseUrl)) name = 'NVIDIA NIM'
    else if (/minimax/i.test(baseUrl)) name = 'MiniMax'
    else if (/api\.kimi\.com/i.test(baseUrl)) name = 'Moonshot AI - Kimi Code'
    else if (routeId && routeId !== 'openai' && routeId !== 'custom')
      name = getRouteLabel(routeId) ?? name
    else if (/moonshot/i.test(baseUrl)) name = 'Moonshot AI - API'
    else if (/deepseek/i.test(baseUrl)) name = 'DeepSeek'
    else if (/mistral/i.test(baseUrl)) name = 'Mistral'
    // rawModel fallback — fires only when base URL is generic/custom.
    else if (/nvidia/i.test(rawModel)) name = 'NVIDIA NIM'
    else if (/minimax/i.test(rawModel)) name = 'MiniMax'
    else if (/\bkimi-for-coding\b/i.test(rawModel))
      name = 'Moonshot AI - Kimi Code'
    else if (/\bkimi-k/i.test(rawModel) || /moonshot/i.test(rawModel))
      name = 'Moonshot AI - API'
    else if (/deepseek/i.test(rawModel)) name = 'DeepSeek'
    else if (/mistral/i.test(rawModel)) name = 'Mistral'
    else if (/llama/i.test(rawModel)) name = 'Meta Llama'
    else if (/bankr/i.test(baseUrl)) name = 'Bankr'
    else if (/bankr/i.test(rawModel)) name = 'Bankr'
    else if (isLocal) name = getLocalOpenAICompatibleProviderLabel(baseUrl)
    
    // Resolve model alias to actual model name + reasoning effort
    let displayModel = resolvedRequest.resolvedModel
    if (resolvedRequest.reasoning?.effort) {
      displayModel = `${displayModel} (${resolvedRequest.reasoning.effort})`
    }
    
    return { name, model: displayModel, baseUrl, isLocal }
  }

  // Default: Anthropic - check settings.model first, then env vars
  const settings = getSettings_DEPRECATED() || {}
  const modelSetting = modelOverride || process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || settings.model || 'claude-sonnet-4-6'
  const resolvedModel = parseUserSpecifiedModel(modelSetting)
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
  const isLocal = isLocalProviderUrl(baseUrl)
  return { name: 'Anthropic', model: resolvedModel, baseUrl, isLocal }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

// Box-drawing helper (boxRow) was removed in the layout rewrite \u2014 the new
// banner uses inline labels instead of a bordered panel.

// ─── Main ─────────────────────────────────────────────────────────────────────

export function printStartupScreen(modelOverride?: string): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const palette = resolveLogoPalette(getGlobalConfig().logoColor)
  const ACCENT = palette.accent
  const CREAM = palette.cream
  const DIMCOL = palette.dim
  const GRAD = palette.gradient

  const p = detectProvider(modelOverride)
  const out: string[] = []

  out.push('')

  // Gradient logo \u2014 paints diagonally top-left \u2192 bottom-right across the rows.
  const total = LOGO_COUNCIL.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    out.push(paintLine(LOGO_COUNCIL[i]!, GRAD, t))
  }

  out.push('')

  // Tagline \u2014 \u2726 on either side in accent, body in cream.
  out.push(`  ${ansiRgb(...ACCENT)}\u2726${RESET} ${ansiRgb(...CREAM)}Four voices. One plan. Real code.${RESET} ${ansiRgb(...ACCENT)}\u2726${RESET}`)
  out.push('')

  // Inline key/value labels \u2014 no box, no border. Label dim, value cream
  // (provider gets the accent color for emphasis; green-ish when local).
  const lbl = (k: string, v: string, c: RGB = CREAM): string => {
    const padK = k.padEnd(9)
    return `  ${DIM}${ansiRgb(...DIMCOL)}${padK}${RESET}  ${ansiRgb(...c)}${v}${RESET}`
  }

  const provC: RGB = p.isLocal ? [140, 200, 160] : ACCENT
  out.push(lbl('provider', p.name, provC))
  out.push(lbl('model', p.model))
  const ep = p.baseUrl.length > 50 ? p.baseUrl.slice(0, 47) + '...' : p.baseUrl
  out.push(lbl('endpoint', ep))
  out.push('')

  // Status line \u2014 \u25cf in provider color, "ready" then a hint to /help.
  const sC: RGB = p.isLocal ? [140, 200, 160] : ACCENT
  const sL = p.isLocal ? 'local' : 'cloud'
  out.push(
    `  ${ansiRgb(...sC)}\u25cf${RESET} ${ansiRgb(...CREAM)}ready${RESET}  ${DIM}${ansiRgb(...DIMCOL)}${sL}${RESET}  ${DIM}${ansiRgb(...DIMCOL)}\u00b7  type ${RESET}${ansiRgb(...ACCENT)}/help${RESET}${DIM}${ansiRgb(...DIMCOL)} to begin${RESET}`
  )
  out.push('')

  // Version footer
  out.push(`  ${DIM}${ansiRgb(...DIMCOL)}council${RESET}  ${ansiRgb(...ACCENT)}v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}${RESET}`)
  out.push('')

  process.stdout.write(out.join('\n') + '\n')
}
