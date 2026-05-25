import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { HYPOTHESIZER_PROMPT } from './prompts.js'

export const HYPOTHESIZER_AGENT: BuiltInAgentDefinition = {
  agentType: 'hypothesizer',
  whenToUse:
    'Debate researcher — mechanism / first-principles lens. Spawned by the debate orchestrator to propose the strongest causal hypothesis. Read-only.',
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
  // Hypothesizer benefits from strong abstract reasoning — Opus is the default.
  // Override via agentRouting in ~/.openclaude/settings.json.
  model: 'claude-opus-4-7',
  color: 'blue',
  omitClaudeMd: false,
  getSystemPrompt: () => HYPOTHESIZER_PROMPT,
}
