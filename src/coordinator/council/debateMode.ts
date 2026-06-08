/**
 * Debate mode helpers — mirrors `councilMode.ts` for the discover flow.
 *
 * Activation is implicit when `/discover` runs (the slash command spawns
 * debate agents directly via the orchestrator, without needing a global
 * env-var flip like council mode does). So unlike `isCouncilMode()`,
 * there's no `isDebateMode()` — debate is per-invocation, not per-session.
 *
 * The agent definitions still need to be REGISTERED with the AgentTool
 * registry so the spawn adapter can find them by subagent_type. That's
 * what `getDebateAgents()` is for — same shape as `getCouncilAgents()`.
 */

import { HYPOTHESIZER_AGENT } from '../../tools/AgentTool/built-in/debate/hypothesizerAgent.js'
import { EMPIRICIST_AGENT } from '../../tools/AgentTool/built-in/debate/empiricistAgent.js'
import { DEVILS_ADVOCATE_AGENT } from '../../tools/AgentTool/built-in/debate/devilsAdvocateAgent.js'
import { METHODOLOGIST_AGENT } from '../../tools/AgentTool/built-in/debate/methodologistAgent.js'
import { SYNTHESIST_AGENT } from '../../tools/AgentTool/built-in/debate/synthesistAgent.js'
import { VERIFIER_AGENT } from '../../tools/AgentTool/built-in/debate/verifierAgent.js'
import type { BuiltInAgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'

export function getDebateAgents(): BuiltInAgentDefinition[] {
  return [
    HYPOTHESIZER_AGENT,
    EMPIRICIST_AGENT,
    DEVILS_ADVOCATE_AGENT,
    METHODOLOGIST_AGENT,
    SYNTHESIST_AGENT,
    VERIFIER_AGENT,
  ]
}
