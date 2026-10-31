import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const execOCCdRemote = vi.hoisted(() => vi.fn())
vi.mock('../install/occd-remote-runtime-control', () => ({ execOCCdRemote }))
const resolveOCCdRemoteContext = vi.hoisted(() => vi.fn())
vi.mock('../install/occd-remote-context', () => ({ resolveOCCdRemoteContext }))

import { occdBoundPort, resolveManagedOCCdTunnelPort } from './occd-managed-bound-port'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { unusedOCCdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

function readinessLine(boundEndpoint: string | null): string {
  return `${JSON.stringify({ type: 'occ_server_ready', runtimeId: 'runtime-1', boundEndpoint })}\n`
}

describe('occdBoundPort', () => {
  it('reads the port occd actually bound', () => {
    expect(occdBoundPort({ boundEndpoint: 'ws://127.0.0.1:58520' })).toBe(58_520)
  })

  it.each([null, 'not a url', 'ws://127.0.0.1'])('returns null for %s', (boundEndpoint) => {
    expect(occdBoundPort({ boundEndpoint })).toBeNull()
  })
})

describe('resolveManagedOCCdTunnelPort', () => {
  const link = {
    sshTargetId: 'ssh-1',
    sshTargetGeneration: 1,
    localPort: 46_768,
    remotePort: 6_768
  }
  function input(kind: 'occdDeployment' | 'sshAccess') {
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the link fields.
      environment: { [kind]: link } as unknown as KnownRuntimeEnvironment,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: passed through to the mocked context.
      target: { id: 'ssh-1' } as SshTarget,
      connection: unusedOCCdHostTransport()
    }
  }

  beforeEach(() => {
    execOCCdRemote.mockReset()
    resolveOCCdRemoteContext.mockReset()
  })

  it('reads the active slot of a managed server', async () => {
    resolveOCCdRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execOCCdRemote.mockResolvedValue(readinessLine('ws://127.0.0.1:58520'))
    await expect(resolveManagedOCCdTunnelPort(input('occdDeployment'))).resolves.toBe(58_520)
  })

  it.each([
    ['no readiness file', ''],
    ['a readiness without an endpoint', readinessLine(null)]
  ])('falls back to the preferred port for %s (older builds)', async (_label, output) => {
    resolveOCCdRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execOCCdRemote.mockResolvedValue(output)
    await expect(resolveManagedOCCdTunnelPort(input('occdDeployment'))).resolves.toBe(6_768)
  })

  it('keeps the configured port for independent SSH access without touching the host', async () => {
    await expect(resolveManagedOCCdTunnelPort(input('sshAccess'))).resolves.toBe(6_768)
    expect(resolveOCCdRemoteContext).not.toHaveBeenCalled()
  })

  it('tries the preferred port when the host cannot be read; the identity check still guards it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveOCCdRemoteContext.mockRejectedValue(new Error('platform probe failed'))
    await expect(resolveManagedOCCdTunnelPort(input('occdDeployment'))).resolves.toBe(6_768)
    warn.mockRestore()
  })
})
