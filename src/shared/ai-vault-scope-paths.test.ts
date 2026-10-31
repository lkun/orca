import { describe, expect, it } from 'vitest'
import type { Worktree } from './worktree/types'
import {
  deriveAiVaultScopeSessionPaths,
  deriveAiVaultWorkspaceScopePaths
} from './ai-vault-scope-paths'

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/occ',
    repoId: 'repo-1',
    displayName: 'occ',
    path: '/repo/occ',
    head: 'abc123',
    branch: 'main',
    isBare: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    isMainWorktree: false,
    ...overrides
  }
}

describe('deriveAiVaultWorkspaceScopePaths', () => {
  it('includes prior paths so renamed workspaces keep their transcripts', () => {
    const active = makeWorktree({
      id: 'repo-1::/repo/occ-renamed',
      path: '/repo/occ-renamed',
      priorWorktreeIds: ['repo-1::/repo/occ']
    })

    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual([
      '/repo/occ-renamed',
      '/repo/occ'
    ])
  })

  it('drops a claimed prior path regardless of where the claimant sits in the list', () => {
    // Exclude the active workspace before indexing owners so duplicates cannot hide later claimants.
    const active = makeWorktree({
      id: 'repo-1::/repo/occ-renamed',
      path: '/repo/occ-renamed',
      priorWorktreeIds: ['repo-1::/repo/occ']
    })
    const claimant = makeWorktree({ id: 'repo-1::/repo/occ', path: '/repo/occ' })
    // Listing the active workspace at the prior path exposes first-writer-wins ownership bugs.
    const activeAtPriorPath = makeWorktree({ id: active.id, path: '/repo/occ' })

    for (const liveWorktrees of [
      [active, claimant],
      [claimant, active],
      [activeAtPriorPath, claimant],
      [claimant, activeAtPriorPath]
    ]) {
      expect(deriveAiVaultWorkspaceScopePaths(active, liveWorktrees)).toEqual([
        '/repo/occ-renamed'
      ])
    }
  })

  it('ignores prior ids belonging to another repo', () => {
    const active = makeWorktree({ priorWorktreeIds: ['repo-2::/repo/other'] })
    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual(['/repo/occ'])
  })

  it('skips relative and blank paths', () => {
    const active = makeWorktree({ path: 'relative/path' })
    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual([])
    expect(deriveAiVaultWorkspaceScopePaths(makeWorktree({ path: '   ' }), [])).toEqual([])
  })
})

describe('deriveAiVaultScopeSessionPaths', () => {
  it('covers the active workspace plus the rest of its repo', () => {
    const active = makeWorktree()
    const sibling = makeWorktree({ id: 'repo-1::/repo/feature', path: '/repo/feature' })
    const otherRepo = makeWorktree({
      id: 'repo-2::/repo/other',
      repoId: 'repo-2',
      path: '/repo/other'
    })

    expect(deriveAiVaultScopeSessionPaths(active, [active, sibling, otherRepo])).toEqual([
      '/repo/occ',
      '/repo/feature'
    ])
  })

  it('deduplicates paths that differ only by separators or trailing slash', () => {
    // The dedupe compares normalized keys; the first spelling is what ships.
    const active = makeWorktree()
    const trailing = makeWorktree({ id: 'repo-1::a', path: '/repo/occ/' })
    const doubled = makeWorktree({ id: 'repo-1::b', path: '/repo//occ' })

    expect(deriveAiVaultScopeSessionPaths(active, [active, trailing, doubled])).toEqual([
      '/repo/occ'
    ])
  })

  it('treats NFD and NFC spellings of one path as the same scope entry', () => {
    // macOS yields NFD on disk while agents record NFC cwds (#10832).
    const nfc = '/repo/프로젝트'
    const active = makeWorktree({ id: `repo-1::${nfc}`, path: nfc })
    const nfd = makeWorktree({ id: 'repo-1::nfd', path: nfc.normalize('NFD') })

    expect(deriveAiVaultScopeSessionPaths(active, [active, nfd])).toEqual([nfc])
  })
})
