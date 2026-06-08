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
import { VERIFIER_PROMPT } from './prompts.js'

/**
 * Verifier — post-synthesis fact-check pass over the Synthesist's brief.
 *
 * Runs AFTER the synthesist completes, BEFORE the brief is written to
 * disk. Reads the brief + all voice positions; emits flagged claims as
 * a `## Verification Notes` section appended to the brief.
 *
 * Tool-stripped like the other fan-out voices — pure analysis over the
 * text it receives.
 *
 * Default model is `deepseek-r1:7b-council` per the BACKLOG design:
 * R1's thinking-trace shape is well-suited to "examine claim X against
 * evidence Y" reasoning, and (importantly) when R1 runs in a verifier
 * role its thinking doesn't matter — only the final flags do, and the
 * orchestrator strips think blocks anyway.
 */
export const VERIFIER_AGENT: BuiltInAgentDefinition = {
  agentType: 'verifier',
  whenToUse:
    'Debate verifier — post-synthesis fact-checker. Spawned by the debate orchestrator AFTER the Synthesist returns its brief, BEFORE the brief is written to disk. Reads the brief + all 4 r1 + 4 r2 voice positions; flags suspect claims (appendix contradictions, named-entity confabulations, ungrounded specificity). Read-only; does not edit files. Never blocks brief output — failures degrade to "no verification notes" rather than aborting.',
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
  // R1's reasoning model fits "examine claim X against evidence Y"
  // exceptionally well. Override via agentRouting in
  // ~/.openclaude/settings.json (e.g. to Claude Opus when available).
  model: 'deepseek-r1:7b-council',
  color: 'cyan',
  omitClaudeMd: false,
  getSystemPrompt: () => VERIFIER_PROMPT,
}
