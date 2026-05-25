/**
 * Vendor-identifying glyph + color per role — both Council and Debate.
 *
 * Used in the agent-panel row to visually mark which vendor is behind each
 * seat at a glance, without taking up the horizontal space a full model ID
 * would. Glyphs are chosen to be unambiguously distinct and available in
 * any reasonable monospace font (no Nerd Font required). Colors map to
 * Ink's named ANSI palette so they render against the terminal's theme
 * without theme-key juggling.
 *
 * Council roles:
 *   architect       Anthropic   ❋ yellow
 *   executor        Anthropic   ❋ yellow
 *   implementer     DeepSeek    ◆ cyan
 *   skeptic         Google      ✦ blue
 *   synthesizer     Google      ✦ blue
 *   critic          OpenAI      ◯ green
 *   tester          Alibaba     ▲ red
 *   security        Mistral     ✺ purple
 *   performance     Mistral     ▶ orange
 *
 * Debate roles (default model bindings — overridable via agentRouting):
 *   hypothesizer    Anthropic   ❋ yellow   (claude-opus-4-7)
 *   empiricist      Google      ✦ blue     (gemini-3.5-flash)
 *   devils_advocate Mistral     ✺ purple   (mistral-large-latest)
 *   methodologist   Alibaba     ▲ red      (qwen3.6-plus)
 *   synthesist      Google      ✦ blue     (gemini-3.5-flash)
 *
 * Returns null for any agentType outside both sets so unrelated sub-agents
 * (Explore, Plan, general-purpose) render unchanged.
 */

export type VendorBadge = {
  glyph: string
  /** Ink Text `color` prop value — named ANSI color. */
  color: string
  /** Vendor label, kept around for tooltips / future a11y surfaces. */
  label: string
}

const ROLE_TO_VENDOR: Record<string, VendorBadge> = {
  // Council
  architect:       { glyph: '❋', color: 'yellow', label: 'Anthropic' },
  executor:        { glyph: '❋', color: 'yellow', label: 'Anthropic' },
  implementer:     { glyph: '◆', color: 'cyan',   label: 'DeepSeek'  },
  skeptic:         { glyph: '✦', color: 'blue',   label: 'Google'    },
  synthesizer:     { glyph: '✦', color: 'blue',   label: 'Google'    },
  critic:          { glyph: '◯', color: 'green',  label: 'OpenAI'    },
  tester:          { glyph: '▲', color: 'red',    label: 'Alibaba'   },
  security:        { glyph: '✺', color: 'purple', label: 'Mistral'   },
  performance:     { glyph: '▶', color: 'orange', label: 'Mistral'   },
  // Debate
  hypothesizer:    { glyph: '❋', color: 'yellow', label: 'Anthropic' },
  empiricist:      { glyph: '✦', color: 'blue',   label: 'Google'    },
  devils_advocate: { glyph: '✺', color: 'purple', label: 'Mistral'   },
  methodologist:   { glyph: '▲', color: 'red',    label: 'Alibaba'   },
  synthesist:      { glyph: '✦', color: 'blue',   label: 'Google'    },
}

export function getCouncilVendorBadge(agentType: string): VendorBadge | null {
  return ROLE_TO_VENDOR[agentType] ?? null
}
