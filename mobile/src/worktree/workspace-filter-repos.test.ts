import { NO_WORKSPACE_ROW_FILTERS } from '../../../src/shared/workspace-view/workspace-row-filters'
import { describe, expect, it } from 'vitest'
import { buildFilterRepos } from './workspace-filter-repos'
import { filterWorktrees, type Worktree } from './workspace-list-sections'

function row(worktreeId: string, repoId: string, hostId: Worktree['hostId']): Worktree {
  return {
    worktreeId,
    repoId,
    hostId,
    repo: 'occ',
    branch: 'feature',
    displayName: worktreeId,
    path: `/tmp/${worktreeId}`,
    liveTerminalCount: 0,
    hasAttachedPty: false,
    unread: false,
    isPinned: false,
    linkedPR: null
  }
}

describe('the repo filter', () => {
  it("lists each host's same-named repo separately, by id, as the desktop's filter does", () => {
    const repos = buildFilterRepos(
      [
        { id: 'local-occ', displayName: 'occ', path: '/Users/me/occ', badgeColor: '#111111' },
        {
          id: 'm4-occ',
          displayName: 'occ',
          path: '/Users/m4air/occ/occ',
          executionHostId: 'runtime:m4air'
        },
        { id: 'assets', displayName: 'design-assets', path: '/Users/me/design-assets' },
        {
          id: 'local-occ',
          displayName: 'occ',
          path: '/srv/occ',
          executionHostId: 'runtime:other'
        }
      ],
      []
    )

    expect(repos.map(({ key, id, name }) => ({ key, id, name }))).toEqual([
      { key: 'local|local-occ', id: 'local-occ', name: 'occ' },
      { key: 'runtime:m4air|m4-occ', id: 'm4-occ', name: 'occ' },
      { key: 'local|assets', id: 'assets', name: 'design-assets' },
      { key: 'runtime:other|local-occ', id: 'local-occ', name: 'occ' }
    ])
    expect(repos[0]?.color).toBe('#111111')
  })

  it('lists the repos the rows name until a catalog answers, still one per repo id', () => {
    const repos = buildFilterRepos(
      [],
      [row('a', 'local-occ', 'local'), row('b', 'm4-occ', 'runtime:m4air')]
    )

    expect(repos.map((repo) => repo.id)).toEqual(['local-occ', 'm4-occ'])
  })

  it('filters by the picked repo id, leaving the same-named repo on another host out', () => {
    const rows = [row('a', 'local-occ', 'local'), row('b', 'm4-occ', 'runtime:m4air')]

    expect(
      filterWorktrees(rows, { ...NO_WORKSPACE_ROW_FILTERS, filterRepoIds: ['m4-occ'] }, '').map(
        (w) => w.worktreeId
      )
    ).toEqual(['b'])
  })
})
