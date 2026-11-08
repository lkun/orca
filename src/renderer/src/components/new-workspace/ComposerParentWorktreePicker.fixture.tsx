import { defineFixture } from '../../component-fixtures/component-fixture'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { ComposerParentWorktreePicker } from './ComposerParentWorktreePicker'

function repo(id: string, displayName: string, executionHostId?: Repo['executionHostId']): Repo {
  return {
    id,
    path: `/src/${displayName}`,
    displayName,
    badgeColor: 'var(--muted-foreground)',
    addedAt: 0,
    ...(executionHostId ? { executionHostId } : {})
  }
}

function worktree(
  id: string,
  repoId: string,
  displayName: string,
  hostId: Worktree['hostId']
): Worktree {
  return {
    id,
    instanceId: `${id}-instance`,
    repoId,
    hostId,
    path: `/src/${displayName}`,
    branch: `refs/heads/${displayName}`,
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

const local = repo('occ-local', 'occ')
const server = repo('occ-server', 'occ', 'runtime:build-box')

/** A new workspace on this Mac may nest under a workspace on a paired server. */
export const parentOnAnotherMachine = defineFixture({
  width: 320,
  store: {
    repos: [local, server],
    worktreesByRepo: {
      [local.id]: [worktree('occ-local::/src/fix-login', local.id, 'fix-login', 'local')],
      [server.id]: [
        worktree(
          'occ-server::/work/fix-login-tests',
          server.id,
          'fix-login-tests',
          'runtime:build-box'
        )
      ]
    }
  },
  render: () => (
    <ComposerParentWorktreePicker
      repoId={local.id}
      executionHostId="local"
      value={null}
      onChange={() => {}}
    />
  ),
  interact: async (frame) => {
    frame.querySelector<HTMLElement>('[role="combobox"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
})
