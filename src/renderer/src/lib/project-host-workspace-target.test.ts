import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Project, ProjectHostSetup } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import {
  resolveWorkspaceCreationRepoId,
  resolveWorkspaceCreationTarget
} from './project-host-workspace-target'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 1,
    ...overrides
  }
}

function makeProject(
  id: string,
  sourceRepoIds: string[],
  overrides: Partial<Project> = {}
): Project {
  return {
    id,
    displayName: id,
    badgeColor: '#000000',
    sourceRepoIds,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeSetup(
  id: string,
  projectId: string,
  hostId: ExecutionHostId,
  repoId: string,
  overrides: Partial<ProjectHostSetup> = {}
): ProjectHostSetup {
  return {
    id,
    projectId,
    hostId,
    repoId,
    path: `/repos/${repoId}`,
    displayName: repoId,
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('project-host workspace target resolution', () => {
  it('falls back to a local setup for a local-only repo', () => {
    const repo = makeRepo('occ')

    const resolution = resolveWorkspaceCreationTarget({ eligibleRepos: [repo] })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        projectId: 'repo:occ',
        hostId: 'local',
        projectHostSetupId: 'occ',
        repoId: 'occ'
      }
    })
  })

  it('chooses the focused host setup when one project exists on multiple hosts', () => {
    const repos = [makeRepo('occ-local'), makeRepo('occ-ssh', { connectionId: 'openclaw-2' })]
    const projects = [makeProject('github:stablyai/occ', ['occ-local', 'occ-ssh'])]
    const projectHostSetups = [
      makeSetup('occ-local', 'github:stablyai/occ', 'local', 'occ-local'),
      makeSetup('occ-ssh', 'github:stablyai/occ', 'ssh:openclaw-2', 'occ-ssh')
    ]

    expect(
      resolveWorkspaceCreationRepoId({
        eligibleRepos: repos,
        projects,
        projectHostSetups,
        projectId: 'github:stablyai/occ',
        focusedHostScope: 'ssh:openclaw-2'
      })
    ).toBe('occ-ssh')
  })

  it('matches duplicate repo ids to the setup execution host', () => {
    const localRepo = makeRepo('occ', { path: '/local/occ' })
    const sshRepo = makeRepo('occ', {
      path: '/remote/occ',
      connectionId: 'builder'
    })
    const projects = [makeProject('github:stablyai/occ', ['occ'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:stablyai/occ', 'local', 'occ'),
      makeSetup('ssh-setup', 'github:stablyai/occ', 'ssh:builder', 'occ')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: [localRepo, sshRepo],
      projects,
      projectHostSetups,
      projectHostSetupId: 'ssh-setup'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        repo: { path: '/remote/occ', connectionId: 'builder' }
      }
    })
  })

  it('keeps a focused duplicate repo id on its selected host', () => {
    const localRepo = makeRepo('occ', { path: '/local/occ' })
    const sshRepo = makeRepo('occ', { path: '/remote/occ', connectionId: 'builder' })
    const projects = [makeProject('github:stablyai/occ', ['occ'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:stablyai/occ', 'local', 'occ'),
      makeSetup('ssh-setup', 'github:stablyai/occ', 'ssh:builder', 'occ')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, sshRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'occ',
        focusedHostScope: 'ssh:builder'
      })
    ).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        projectHostSetupId: 'ssh-setup',
        repo: { path: '/remote/occ', connectionId: 'builder' }
      }
    })
  })

  it('resolves duplicate repo ids to a ready setup when no host is focused', () => {
    const localRepo = makeRepo('occ', { path: '/local/occ' })
    const sshRepo = makeRepo('occ', { path: '/remote/occ', connectionId: 'builder' })
    const projects = [makeProject('github:stablyai/occ', ['occ'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:stablyai/occ', 'local', 'occ'),
      makeSetup('ssh-setup', 'github:stablyai/occ', 'ssh:builder', 'occ')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, sshRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'occ',
        focusedHostScope: 'all',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'local',
        projectHostSetupId: 'local-setup',
        repoId: 'occ',
        repo: { path: '/local/occ' }
      }
    })
  })

  it('resolves an explicit project and host to the matching setup', () => {
    const repos = [
      makeRepo('occ-local'),
      makeRepo('occ-runtime', { executionHostId: 'runtime:gpu-1' })
    ]
    const projects = [makeProject('github:stablyai/occ', ['occ-local', 'occ-runtime'])]
    const projectHostSetups = [
      makeSetup('occ-local', 'github:stablyai/occ', 'local', 'occ-local'),
      makeSetup('occ-runtime', 'github:stablyai/occ', 'runtime:gpu-1', 'occ-runtime')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectId: 'github:stablyai/occ',
      hostId: 'runtime:gpu-1'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        projectId: 'github:stablyai/occ',
        hostId: 'runtime:gpu-1',
        projectHostSetupId: 'occ-runtime',
        repoId: 'occ-runtime'
      }
    })
  })

  it('canonicalizes a stale same-host setup id to the setup the picker shows', () => {
    // Legacy drafts can name hidden duplicate setups; creation must use the canonical picker row/path.
    const repos = [makeRepo('occ-main'), makeRepo('occ-worktree')]
    const projects = [makeProject('github:stablyai/occ', ['occ-main', 'occ-worktree'])]
    const projectHostSetups = [
      makeSetup('occ-main', 'github:stablyai/occ', 'local', 'occ-main'),
      makeSetup('occ-worktree', 'github:stablyai/occ', 'local', 'occ-worktree')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectHostSetupId: 'occ-worktree'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'occ-main', repoId: 'occ-main', hostId: 'local' }
    })
  })

  it('keeps an explicit setup id that is the only one on its host', () => {
    const repos = [makeRepo('occ-local'), makeRepo('occ-ssh', { connectionId: 'builder' })]
    const projects = [makeProject('github:stablyai/occ', ['occ-local', 'occ-ssh'])]
    const projectHostSetups = [
      makeSetup('occ-local', 'github:stablyai/occ', 'local', 'occ-local'),
      makeSetup('occ-ssh', 'github:stablyai/occ', 'ssh:builder', 'occ-ssh')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: repos,
        projects,
        projectHostSetups,
        projectHostSetupId: 'occ-ssh'
      })
    ).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'occ-ssh', repoId: 'occ-ssh', hostId: 'ssh:builder' }
    })
  })

  it('does not merge same-name repos without shared project identity', () => {
    const repos = [
      makeRepo('personal-occ', { displayName: 'occ' }),
      makeRepo('work-occ', { displayName: 'occ', connectionId: 'work-linux' })
    ]

    expect(
      resolveWorkspaceCreationRepoId({
        eligibleRepos: repos,
        projectId: 'repo:personal-occ',
        focusedHostScope: 'ssh:work-linux'
      })
    ).toBe('personal-occ')
  })

  it('reports unavailable when the project is not set up on the selected host', () => {
    const repo = makeRepo('occ')
    const projects = [makeProject('github:stablyai/occ', ['occ'])]
    const projectHostSetups = [makeSetup('occ', 'github:stablyai/occ', 'local', 'occ')]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectId: 'github:stablyai/occ',
        hostId: 'ssh:openclaw-2'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('does not fall back to another host when only a host is selected', () => {
    const localRepo = makeRepo('occ-local')
    const remoteRepo = makeRepo('occ-ssh', { connectionId: 'builder' })
    const projects = [makeProject('github:stablyai/occ', ['occ-local', 'occ-ssh'])]
    const projectHostSetups = [
      makeSetup('occ-local', 'github:stablyai/occ', 'local', 'occ-local')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'occ-local',
        hostId: 'ssh:builder',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('reports setup-not-ready when the selected host has pending setup metadata', () => {
    const repo = makeRepo('occ')
    const projects = [makeProject('github:stablyai/occ', ['occ'])]
    const projectHostSetups = [
      makeSetup('occ', 'github:stablyai/occ', 'local', 'occ'),
      makeSetup('gpu-pending', 'github:stablyai/occ', 'runtime:gpu', '', {
        path: '',
        setupState: 'setting-up',
        setupMethod: 'provisioned'
      })
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectId: 'github:stablyai/occ',
        hostId: 'runtime:gpu'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'setup-not-ready'
    })
  })

  it('reports unavailable when an explicit setup is not ready', () => {
    const repo = makeRepo('occ')
    const projects = [makeProject('github:stablyai/occ', ['occ'])]
    const projectHostSetups = [
      makeSetup('occ', 'github:stablyai/occ', 'local', 'occ', { setupState: 'setting-up' })
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectHostSetupId: 'occ'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'setup-not-ready'
    })
  })

  it('does not resolve workspace creation through a removed host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const projects = [makeProject('repo:remote', ['remote-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:remote', 'ssh:removed', 'remote-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })

  it('does not silently switch an explicit setup id to an actionable sibling host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const localRepo = makeRepo('local-repo')
    const projects = [makeProject('repo:occ', ['remote-repo', 'local-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:occ', 'ssh:removed', 'remote-repo'),
      makeSetup('local-setup', 'repo:occ', 'local', 'local-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo, localRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })

  // Project selection treats the current host as preference; a project available only elsewhere must resolve there instead of silently returning empty.
  describe('cross-host project selection', () => {
    const repos = [makeRepo('local-repo'), makeRepo('remote-repo', { connectionId: 'remote-1' })]
    const projects = [
      makeProject('repo:local-repo', ['local-repo']),
      makeProject('repo:remote-repo', ['remote-repo'])
    ]
    const projectHostSetups = [
      makeSetup('local-repo', 'repo:local-repo', 'local', 'local-repo'),
      makeSetup('remote-repo', 'repo:remote-repo', 'ssh:remote-1', 'remote-repo')
    ]

    it('resolves a remote-only project while the current host is local', () => {
      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:remote-repo',
          focusedHostScope: 'local'
        })
      ).toBe('remote-repo')
    })

    it('resolves a local-only project while the current host is remote', () => {
      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:local-repo',
          focusedHostScope: 'ssh:remote-1'
        })
      ).toBe('local-repo')
    })

    it('still prefers the current host when the project is set up on it', () => {
      const multiHostProjects = [makeProject('repo:multi', ['multi-local', 'multi-remote'])]
      const multiHostSetups = [
        makeSetup('multi-local', 'repo:multi', 'local', 'multi-local'),
        makeSetup('multi-remote', 'repo:multi', 'ssh:remote-1', 'multi-remote')
      ]

      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: [
            makeRepo('multi-local'),
            makeRepo('multi-remote', { connectionId: 'remote-1' })
          ],
          projects: multiHostProjects,
          projectHostSetups: multiHostSetups,
          projectId: 'repo:multi',
          focusedHostScope: 'local'
        })
      ).toBe('multi-local')
    })

    it('still reports unavailable for an explicit project+host with no ready setup', () => {
      // Explicit Run on host selection retains strict project+host matching; only project-dropdown calls use preference.
      expect(
        resolveWorkspaceCreationTarget({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:remote-repo',
          hostId: 'local'
        })
      ).toEqual({
        status: 'unavailable',
        reason: 'project-not-set-up-on-host'
      })
    })
  })
})
