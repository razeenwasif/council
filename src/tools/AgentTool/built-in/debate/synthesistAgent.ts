import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/constants.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { SYNTHESIST_PROMPT } from './prompts.js'

export const SYNTHESIST_AGENT: BuiltInAgentDefinition = {
  agentType: 'synthesist',
  whenToUse:
    'Debate Synthesist — produces the final research brief from all rounds of positions. No tools (reasons over provided text only). Symmetric to the Council Synthesizer.',
  // No tools at all — Synthesist reads what was provided + outputs.
  // Disallowing Read/Grep/Glob too prevents the model from drifting
  // off into independent verification (its job is fair synthesis of
  // the voices that spoke, not a re-litigation).
  disallowedTools: [
    AGENT_TOOL_NAME,
    BASH_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
    FILE_READ_TOOL_NAME,
    GREP_TOOL_NAME,
    GLOB_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  // Synthesist needs strong text reasoning over long context — Gemini
  // Flash handles this well and is cheap. Override via agentRouting.
  model: 'gemini-3.5-flash',
  color: 'cyan',
  omitClaudeMd: false,
  getSystemPrompt: () => SYNTHESIST_PROMPT,
}
