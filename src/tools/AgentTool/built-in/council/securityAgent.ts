import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { SECURITY_PROMPT } from './prompts.js'

export const SECURITY_AGENT: BuiltInAgentDefinition = {
  agentType: 'security',
  whenToUse:
    'Council member — threat-modeling / trust-boundary lens. Spawned by the council coordinator alongside the other voice members. Names specific bug classes (injection, path traversal, SSRF, weak crypto, secret leakage) and recommends concrete defenses. Read-only; does not edit files.',
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
  model: 'mistral-large-latest',
  color: 'purple',
  omitClaudeMd: false,
  getSystemPrompt: () => SECURITY_PROMPT,
}
