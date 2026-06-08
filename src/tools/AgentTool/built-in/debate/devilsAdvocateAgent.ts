import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/constants.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { DEVILS_ADVOCATE_PROMPT } from './prompts.js'

export const DEVILS_ADVOCATE_AGENT: BuiltInAgentDefinition = {
  agentType: 'devils_advocate',
  whenToUse:
    "Debate researcher — adversarial / counter-position lens. Spawned by the debate orchestrator to surface the strongest objection to the leading hypothesis. Read-only + WebFetch allowed (counter-positions are stronger when grounded).",
  disallowedTools: [
    AGENT_TOOL_NAME,
    BASH_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_READ_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  // Devil's Advocate works best with a model that doesn't capitulate
  // when challenged. Mistral-large has shown a good adversarial stance
  // in council's Security role. Override via agentRouting.
  model: 'mistral-large-latest',
  color: 'purple',
  omitClaudeMd: false,
  getSystemPrompt: () => DEVILS_ADVOCATE_PROMPT,
}
