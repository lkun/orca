import { describe, expect, it } from 'vitest'
import { parseOCCBrowserCommand } from './occ-browser-cli-commands'

describe('parseOCCBrowserCommand', () => {
  it.each([
    'occ worktree ls',
    'occ terminal send --text "occ click"',
    'occstra click',
    'occ',
    'echo occ click',
    'echo "docs; occ snapshot --page p1; text"',
    "git commit -m 'run occ click | occ snapshot'",
    'git log --oneline'
  ])('does not match %s', (command) => {
    expect(parseOCCBrowserCommand(command)).toBeNull()
  })
})
