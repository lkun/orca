import { describe, expect, it } from 'vitest'
import { parseOCCBrowserCommand } from './occ-browser-cli-commands'

describe('parseOCCBrowserCommand', () => {
  it.each([
    ['occ click --element e3', null],
    ['occ snapshot --page p1', 'p1'],
    ['occ-dev fill --element e2 --text hi --page=p2', 'p2'],
    ["occ goto --url https://example.com --page='p3'", 'p3'],
    ['/Users/me/.local/bin/occ screenshot', null],
    ['C:\\Users\\me\\occ\\occ.cmd tab create', null],
    ['occ-ide mouse move --x 1 --y 2', null],
    ['cd app && occ click --element e3 --page p4', 'p4'],
    ['git status; OCC_DEBUG=1 occ tab list', null],
    ['occ snapshot | head -20', null],
    ['occ browser identity get', null]
  ])('matches %s', (command, pageId) => {
    expect(parseOCCBrowserCommand(command)).toEqual({ pageId })
  })

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
