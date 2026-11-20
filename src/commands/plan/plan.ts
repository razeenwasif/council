import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { handlePlanModeTransition } from '../../bootstrap/state.js'
import { openFileInExternalEditor } from '../../utils/editor.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js'
import { getPlan, getPlanFilePath } from '../../utils/plans.js'

const USAGE = [
  'Usage:',
  '  /plan        turn on plan mode, or show the plan when it is already on',
  '  /plan open   open this session\'s plan in your editor',
].join('\n')

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

export const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim()
  const planPath = getPlanFilePath()

  if (arg === 'open') {
    if (getPlan() === null) {
      return text(`No plan yet for this session. It will be written to ${planPath}.`)
    }
    return openFileInExternalEditor(planPath)
      ? text(`Opened ${planPath}`)
      : text(`No editor found; set $EDITOR or $VISUAL. The plan is at ${planPath}`)
  }
  if (arg !== '') {
    return text(USAGE)
  }

  const mode = context.getAppState().toolPermissionContext.mode
  if (mode !== 'plan') {
    // The same entry as the EnterPlanMode tool: prepareContextForPlanMode
    // remembers the mode to return to, then the mode becomes 'plan'.
    handlePlanModeTransition(mode, 'plan')
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(
        prepareContextForPlanMode(prev.toolPermissionContext),
        { type: 'setMode', mode: 'plan', destination: 'session' },
      ),
    }))
    return text('Plan mode on. The agent will explore and write a plan before changing anything.')
  }

  const content = getPlan()
  if (content === null) {
    return text(`Plan mode is on. No plan written yet; it will be at ${planPath}.`)
  }
  return text(`Current plan (${planPath}):\n\n${content}`)
}
