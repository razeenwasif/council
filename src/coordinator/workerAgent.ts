import type { BuiltInAgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { EXPLORE_AGENT } from '../tools/AgentTool/built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from '../tools/AgentTool/built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from '../tools/AgentTool/built-in/planAgent.js'
import { getCouncilAgents, isCouncilMode } from './council/councilMode.js'

// The coordinator system prompt instructs the model to spawn workers with
// subagent_type: "worker". This agent definition matches that type so
// AgentTool.tsx can resolve it. It reuses GENERAL_PURPOSE_AGENT's capabilities.
const WORKER_AGENT: BuiltInAgentDefinition = {
  ...GENERAL_PURPOSE_AGENT,
  agentType: 'worker',
  whenToUse:
    'Worker agent for coordinator mode. Executes tasks autonomously — research, implementation, or verification.',
}

export function getCoordinatorAgents(): BuiltInAgentDefinition[] {
  // Council mode replaces the generic worker set with the six fixed council
  // roles. The coordinator system prompt (see coordinatorMode.ts) is also
  // swapped in lockstep so the LLM knows to spawn architect/implementer/etc.
  // instead of "worker".
  if (isCouncilMode()) {
    return getCouncilAgents()
  }
  return [WORKER_AGENT, GENERAL_PURPOSE_AGENT, EXPLORE_AGENT, PLAN_AGENT]
}
