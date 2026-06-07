import type { Command } from '../../commands.js'

const note: Command = {
  type: 'local-jsx',
  name: 'note',
  description: 'Append a note to the session scratchpad pane',
  immediate: true,
  load: () => import('./note.js'),
}

export default note
