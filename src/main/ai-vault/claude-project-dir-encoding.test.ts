import { describe, expect, it } from 'vitest'
import {
  encodeClaudeProjectPath,
  encodeClaudeProjectPaths,
  isClaudeProjectDirInScope
} from './claude-project-dir-encoding'

describe('encodeClaudeProjectPath', () => {
  it('emits one dash per non-alphanumeric character rather than per run', () => {
    expect(encodeClaudeProjectPath('/Users/ada/occ/workspaces')).toBe('-Users-ada-occ-workspaces')
    expect(encodeClaudeProjectPath('/Users/ada/.occ/worktrees')).toBe('-Users-ada--occ-worktrees')
  })

  it('encodes a Windows drive path', () => {
    expect(encodeClaudeProjectPath('C:\\Users\\ada\\occ\\workspaces')).toBe(
      'C--Users-ada-occ-workspaces'
    )
    expect(encodeClaudeProjectPath('C:\\')).toBe('C--')
  })

  it('encodes a WSL UNC path', () => {
    expect(encodeClaudeProjectPath('\\\\wsl$\\Ubuntu\\home\\ada\\occ\\workspaces')).toBe(
      '--wsl--Ubuntu-home-ada-occ-workspaces'
    )
  })

  it('drops trailing separators but keeps a bare root', () => {
    expect(encodeClaudeProjectPath('/Users/ada/occ/')).toBe('-Users-ada-occ')
    expect(encodeClaudeProjectPath('/')).toBe('-')
  })

  it('offers the NFC spelling alongside the raw one', () => {
    const nfd = '/Users/ada/cafe\u0301'
    expect(encodeClaudeProjectPaths(nfd)).toEqual([
      encodeClaudeProjectPath(nfd),
      encodeClaudeProjectPath(nfd.normalize('NFC'))
    ])
    expect(encodeClaudeProjectPaths('/Users/ada/cafe')).toEqual(['-Users-ada-cafe'])
  })
})

describe('isClaudeProjectDirInScope', () => {
  it('accepts the prefix itself and its dash-delimited descendants', () => {
    expect(isClaudeProjectDirInScope('-w-occ', ['-w-occ'])).toBe(true)
    expect(isClaudeProjectDirInScope('-w-occ-nautilus', ['-w-occ'])).toBe(true)
  })

  it('rejects a sibling that merely starts with the prefix', () => {
    expect(isClaudeProjectDirInScope('-w-occdyne-nautilus', ['-w-occ'])).toBe(false)
  })
})
