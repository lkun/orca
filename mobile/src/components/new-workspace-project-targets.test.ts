import { describe, expect, it } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../src/shared/execution-host'
import {
  buildNewWorkspaceProjectOptions,
  buildNewWorkspaceRunTargetOptions,
  getNewWorkspaceRunTarget
} from './new-workspace-project-targets'

const LOCAL_HOST_LABEL = getLocalExecutionHostLabel('darwin')

describe('new workspace project targets', () => {
  it('groups local and SSH checkouts of the same project', () => {
    const upstream = { owner: 'stablyai', repo: 'occ' }
    const options = buildNewWorkspaceProjectOptions([
      { id: 'local', displayName: 'occ', path: '/src/occ', upstream },
      {
        id: 'ssh',
        displayName: 'occ',
        path: '/home/dev/occ',
        connectionId: 'build-server',
        upstream
      }
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ label: 'occ', detail: 'stablyai/occ' })
  })

  it('shows the provider slug recovered from canonical git identity', () => {
    const options = buildNewWorkspaceProjectOptions([
      {
        id: 'local',
        displayName: 'occ',
        path: '/src/occ',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/stablyai/occ',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:stablyai/occ.git'
        }
      }
    ])

    expect(options[0]).toMatchObject({ label: 'occ', detail: 'stablyai/occ' })
  })

  it('labels local, SSH, and paired runtime targets as the host list names them', () => {
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'occ', path: '/src/occ' }, 'darwin')
    ).toEqual({ hostId: 'local', label: LOCAL_HOST_LABEL, detail: '/src/occ' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'occ', path: 'C:\\src\\occ' })
    ).toMatchObject({ label: 'This computer' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'occ', path: 'C:\\src\\occ' }, 'win32')
    ).toMatchObject({ label: 'Local Windows' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'ssh',
        displayName: 'occ',
        path: 'C:\\src\\occ',
        executionHostId: 'ssh:Windows%20VM'
      })
    ).toEqual({ hostId: 'ssh:Windows%20VM', label: 'Windows VM', detail: 'C:\\src\\occ' })
    const server = {
      id: 'runtime',
      displayName: 'occ',
      path: '/src/occ',
      executionHostId: 'runtime:20269ff3-60aa-4e79-a581-513a3f8e394b'
    } as const
    const labels = new Map([[server.executionHostId, 'scratch-server']] as const)
    expect(getNewWorkspaceRunTarget(server, 'darwin', labels)).toEqual({
      hostId: server.executionHostId,
      label: 'scratch-server',
      detail: '/src/occ'
    })
  })

  it('shows one target per host when the project has multiple local worktrees', () => {
    const upstream = { owner: 'stablyai', repo: 'occ' }
    const repos = [
      { id: 'local-a', displayName: 'occ-a', path: '/src/occ-a', upstream },
      { id: 'local-b', displayName: 'occ-b', path: '/src/occ-b', upstream },
      {
        id: 'ssh',
        displayName: 'occ',
        path: '/home/dev/occ',
        connectionId: 'build-server',
        upstream
      }
    ]
    const projectId = buildNewWorkspaceProjectOptions(repos)[0]?.id ?? null

    expect(buildNewWorkspaceRunTargetOptions(repos, projectId, 'darwin')).toEqual([
      expect.objectContaining({ id: 'local', label: LOCAL_HOST_LABEL, detail: '/src/occ-a' }),
      expect.objectContaining({
        id: 'ssh:build-server',
        label: 'build-server',
        detail: '/home/dev/occ'
      })
    ])
  })
})
