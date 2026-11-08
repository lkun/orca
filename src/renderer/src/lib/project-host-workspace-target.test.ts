import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Project, ProjectHostSetup } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import { resolveWorkspaceCreationTarget } from './project-host-workspace-target'

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

  it('keeps an explicit setup for a second checkout of the project on the same host', () => {
    // Two clones of one remote share a project; the picker lists each, so the chosen one must be created in.
    const repos = [makeRepo('occ-main'), makeRepo('occ-review')]
    const projects = [makeProject('github:stablyai/occ', ['occ-main', 'occ-review'])]
    const projectHostSetups = [
      makeSetup('occ-main', 'github:stablyai/occ', 'local', 'occ-main'),
      makeSetup('occ-review', 'github:stablyai/occ', 'local', 'occ-review')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectHostSetupId: 'occ-review'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'occ-review', repoId: 'occ-review', hostId: 'local' }
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
})
