import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { GENERAL_PURPOSE_AGENT } from '../generalPurposeAgent.js'

// Executor reuses the general-purpose worker's capabilities (full tool
// access — Bash, file edit, file write, etc.) — it's the only agent that
// touches the filesystem. The role marker is the agentType and a thin
// initial-prompt override; everything else is inherited.
//
// Pinned to Claude Opus per the v1 spec; override via agentRouting if
// you want to swap models.
export const EXECUTOR_AGENT: BuiltInAgentDefinition = {
  ...GENERAL_PURPOSE_AGENT,
  agentType: 'executor',
  whenToUse:
    'Council executor — receives the synthesizer\'s unified plan and makes the actual code changes. The only council role with filesystem/shell tools. Spawned by the council coordinator after synthesis.',
  model: 'claude-opus-4-7',
  color: 'yellow',
}
