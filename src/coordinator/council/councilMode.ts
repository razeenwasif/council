import { isEnvTruthy } from '../../utils/envUtils.js'
import { COUNCIL_COORDINATOR_PROMPT } from '../../tools/AgentTool/built-in/council/prompts.js'
import { ARCHITECT_AGENT } from '../../tools/AgentTool/built-in/council/architectAgent.js'
import { IMPLEMENTER_AGENT } from '../../tools/AgentTool/built-in/council/implementerAgent.js'
import { SKEPTIC_AGENT } from '../../tools/AgentTool/built-in/council/skepticAgent.js'
import { CRITIC_AGENT } from '../../tools/AgentTool/built-in/council/criticAgent.js'
import { SYNTHESIZER_AGENT } from '../../tools/AgentTool/built-in/council/synthesizerAgent.js'
import { EXECUTOR_AGENT } from '../../tools/AgentTool/built-in/council/executorAgent.js'
import { TESTER_AGENT } from '../../tools/AgentTool/built-in/council/testerAgent.js'
import { SECURITY_AGENT } from '../../tools/AgentTool/built-in/council/securityAgent.js'
import { PERFORMANCE_AGENT } from '../../tools/AgentTool/built-in/council/performanceAgent.js'
import type { BuiltInAgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'

// Council mode rides on top of coordinator mode. The coordinator infrastructure
// (AgentTool, SendMessageTool, task-notification flow, async agents) is what
// makes the council workflow possible — council mode just narrows the agent
// set and replaces the coordinator system prompt with the fixed workflow.
//
// Activation: set CLAUDE_CODE_COUNCIL_MODE=1 (and CLAUDE_CODE_COORDINATOR_MODE=1
// — council depends on coordinator infrastructure). The /council slash command
// handles both env vars in one step.

export function isCouncilMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_COUNCIL_MODE)
}

export function getCouncilAgents(): BuiltInAgentDefinition[] {
  return [
    ARCHITECT_AGENT,
    IMPLEMENTER_AGENT,
    SKEPTIC_AGENT,
    CRITIC_AGENT,
    TESTER_AGENT,
    SECURITY_AGENT,
    PERFORMANCE_AGENT,
    SYNTHESIZER_AGENT,
    EXECUTOR_AGENT,
  ]
}

export function getCouncilSystemPrompt(): string {
  return COUNCIL_COORDINATOR_PROMPT
}
