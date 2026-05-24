import { AGENT_TOOL_NAME } from '../../constants.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../../loadAgentsDir.js'
import { PERFORMANCE_PROMPT } from './prompts.js'

export const PERFORMANCE_AGENT: BuiltInAgentDefinition = {
  agentType: 'performance',
  whenToUse:
    'Council member — runtime-cost / scaling lens. Spawned by the council coordinator alongside the other voice members. Identifies the expected N, asymptotic complexity, allocations in hot paths, and blocking I/O on the critical path. Read-only; does not edit files.',
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
  model: 'mistral-medium-latest',
  color: 'orange',
  // Originally bound to Groq's llama-3.3-70b-versatile but Groq enforces a
  // 20MB HTTP body cap on the free tier, which openclaude's auto-injected
  // sub-agent context blew past. Swapped to Mistral Medium — different
  // model from Security's mistral-large-latest so the voice stays distinct.
  // omitClaudeMd kept on as a precaution; Mistral has more headroom but no
  // point dragging project rules into a performance-analysis pass.
  omitClaudeMd: true,
  getSystemPrompt: () => PERFORMANCE_PROMPT,
}
