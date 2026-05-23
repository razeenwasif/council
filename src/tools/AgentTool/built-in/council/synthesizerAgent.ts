import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { SYNTHESIZER_PROMPT } from './prompts.js'

// Synthesizer is pure text-in / text-out. No tools at all — it reads the
// four proposals and emits a unified plan. Disallowing read tools too
// prevents it from drifting into research and burning latency/cost.
export const SYNTHESIZER_AGENT: BuiltInAgentDefinition = {
  agentType: 'synthesizer',
  whenToUse:
    'Council judge — reads the four council proposals and emits one unified plan for the executor. Spawned by the council coordinator after all four members report.',
  disallowedTools: [
    AGENT_TOOL_NAME,
    BASH_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_READ_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'gemini-3.5-flash',
  color: 'cyan',
  omitClaudeMd: true,
  getSystemPrompt: () => SYNTHESIZER_PROMPT,
}
