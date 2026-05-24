/**
 * Vendor-identifying glyph + color per council role.
 *
 * Used in the agent-panel row to visually mark which vendor is behind each
 * council seat at a glance, without taking up the horizontal space a full
 * model ID would. Glyphs are chosen to be unambiguously distinct from each
 * other and to be available in any reasonable monospace font (no Nerd Font
 * required). Colors map to Ink's named ANSI palette so they render against
 * the terminal's theme without theme-key juggling.
 *
 *   architect    Anthropic   ❋ yellow
 *   executor     Anthropic   ❋ yellow
 *   implementer  DeepSeek    ◆ cyan
 *   skeptic      Google      ✦ blue
 *   synthesizer  Google      ✦ blue
 *   critic       OpenAI      ◯ green
 *   tester       Alibaba     ▲ red
 *   security     Mistral     ✺ purple
 *   performance  Mistral     ▶ orange
 *
 * Returns null for any agentType outside the council set so non-council
 * sub-agents (Explore, Plan, general-purpose) render unchanged.
 */

export type VendorBadge = {
  glyph: string
  /** Ink Text `color` prop value — named ANSI color. */
  color: string
  /** Vendor label, kept around for tooltips / future a11y surfaces. */
  label: string
}

const COUNCIL_ROLE_TO_VENDOR: Record<string, VendorBadge> = {
  architect:   { glyph: '❋', color: 'yellow', label: 'Anthropic' },
  executor:    { glyph: '❋', color: 'yellow', label: 'Anthropic' },
  implementer: { glyph: '◆', color: 'cyan',   label: 'DeepSeek'  },
  skeptic:     { glyph: '✦', color: 'blue',   label: 'Google'    },
  synthesizer: { glyph: '✦', color: 'blue',   label: 'Google'    },
  critic:      { glyph: '◯', color: 'green',  label: 'OpenAI'    },
  tester:      { glyph: '▲', color: 'red',    label: 'Alibaba'   },
  security:    { glyph: '✺', color: 'purple', label: 'Mistral'   },
  performance: { glyph: '▶', color: 'orange', label: 'Mistral'   },
}

export function getCouncilVendorBadge(agentType: string): VendorBadge | null {
  return COUNCIL_ROLE_TO_VENDOR[agentType] ?? null
}
