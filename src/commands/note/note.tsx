import * as React from 'react'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { appendNote, clearNotes, getNotes } from '../../utils/scratchpadStore.js'

const HELP =
  'Usage:\n' +
  '  /note <text>   — append a note (persists to ~/.openclaude/scratchpad.json)\n' +
  '  /note clear    — wipe all notes\n' +
  '  /note list     — print current notes\n'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const raw = (args ?? '').trim()

  if (raw === '' || raw === 'help' || raw === '--help' || raw === '-h') {
    onDone(HELP, { display: 'system' })
    return null
  }

  if (raw === 'clear') {
    clearNotes()
    onDone('Scratchpad cleared.', { display: 'system' })
    return null
  }

  if (raw === 'list') {
    const notes = getNotes()
    if (notes.length === 0) {
      onDone('Scratchpad is empty.', { display: 'system' })
    } else {
      const summary = notes.map((n, i) => `  ${i + 1}. ${n}`).join('\n')
      onDone(`Scratchpad (${notes.length} note${notes.length === 1 ? '' : 's'}):\n${summary}`, {
        display: 'system',
      })
    }
    return null
  }

  appendNote(raw)
  onDone(`Note added.`, { display: 'system' })
  return null
}
