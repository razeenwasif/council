import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { ARCHITECT_PROMPT } from './prompts.js'

export const ARCHITECT_AGENT: BuiltInAgentDefinition = {
  agentType: 'architect',
  whenToUse:
    'Council member — structural/design lens. Spawned by the council coordinator alongside implementer, skeptic, and critic to produce a structured proposal for an engineering request. Read-only; does not edit files.',
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
  // Model binding — override via agentRouting in ~/.openclaude.json if needed.
  model: 'claude-opus-4-7',
  color: 'blue',
  omitClaudeMd: false,
  getSystemPrompt: () => ARCHITECT_PROMPT,
}
