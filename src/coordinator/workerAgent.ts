import type { BuiltInAgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { EXPLORE_AGENT } from '../tools/AgentTool/built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from '../tools/AgentTool/built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from '../tools/AgentTool/built-in/planAgent.js'
import { getCouncilAgents, isCouncilMode } from './council/councilMode.js'
import { getDebateAgents } from './council/debateMode.js'

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
  // Council mode replaces the generic worker set with the seven council
  // roles AND the five debate roles — `/discover` can be invoked
  // mid-session via slash command and needs the agents registered for
  // AgentTool to spawn them. Registering both is cheap (the registry
  // is just a lookup map); they have no overlap in agentType.
  if (isCouncilMode()) {
    return [...getCouncilAgents(), ...getDebateAgents()]
  }
  return [WORKER_AGENT, GENERAL_PURPOSE_AGENT, EXPLORE_AGENT, PLAN_AGENT]
}
