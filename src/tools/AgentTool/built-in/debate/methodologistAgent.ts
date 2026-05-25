import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { METHODOLOGIST_PROMPT } from './prompts.js'

export const METHODOLOGIST_AGENT: BuiltInAgentDefinition = {
  agentType: 'methodologist',
  whenToUse:
    'Debate researcher — experimental-design / falsifiability lens. Spawned by the debate orchestrator to propose concrete tests that distinguish hypotheses from their nulls. Read-only + WebFetch allowed.',
  disallowedTools: [
    AGENT_TOOL_NAME,
    BASH_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  // Methodologist needs careful, systematic reasoning. Qwen3.6-plus has
  // performed well as Council's Tester for similar work. Override via
  // agentRouting.
  model: 'qwen3.6-plus',
  color: 'red',
  omitClaudeMd: false,
  getSystemPrompt: () => METHODOLOGIST_PROMPT,
}
