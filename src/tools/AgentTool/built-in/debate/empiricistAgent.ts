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
import { EMPIRICIST_PROMPT } from './prompts.js'

export const EMPIRICIST_AGENT: BuiltInAgentDefinition = {
  agentType: 'empiricist',
  whenToUse:
    'Debate researcher — evidence-grounding lens. Spawned by the debate orchestrator to surface specific findings from the provided literature and external sources. Read-only + WebFetch allowed.',
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
  // Empiricist needs strong reading + citation discipline. Gemini Flash
  // is the default — good at literature engagement, cheap. Override
  // via agentRouting if a beefier reader is preferred.
  model: 'gemini-3.5-flash',
  color: 'green',
  omitClaudeMd: false,
  getSystemPrompt: () => EMPIRICIST_PROMPT,
}
