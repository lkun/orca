import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isManagedOCCdSshTarget,
  isRuntimeOwnedSshTarget,
  SshConnectionStore
} from './ssh-connection-store'
import { createMockStore } from './ssh-connection-store-test-fixture'
import { emptyDependentStateStore } from '../targets/ssh-target-occd-dependents-fixture'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('../config/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  loadUserSshConfigWithText: () => ({ hosts: loadUserSshConfigMock(), text: '' }),
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

const base = { label: 'cluster', host: 'cluster.example.com', port: 22, username: 'dev' }

describe('managed occd ownership of SSH targets', () => {
  let mockStore: ReturnType<typeof createMockStore>
  let sshStore: SshConnectionStore

  beforeEach(() => {
    mockStore = Object.assign(createMockStore(), emptyDependentStateStore())
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture implements the store methods SshConnectionStore calls.
    sshStore = new SshConnectionStore(mockStore as never, { config: async () => null })
    loadUserSshConfigMock.mockReset()
    sshConfigHostsToTargetsMock.mockReset()
  })

  it('lists managed and provisioning hosts with their status, and hides only runtime-owned ones', () => {
    sshStore.addTarget(base)
    sshStore.addTarget({
      ...base,
      label: 'provisioning',
      occdProvisioning: { requestId: 'r', name: 'n' }
    })
    const claimed = sshStore.addTarget({ ...base, label: 'claimed' })
    sshStore.getOCCdRuntimeClaims().claim(claimed.id, 'environment-1', { ownerRecorded: false })
    mockStore.addSshTarget({
      ...base,
      id: 'runtime-ssh-vm',
      label: 'vm',
      owner: { type: 'on-demand-runtime', runtimeId: 'vm-1' }
    })

    expect(sshStore.listTargets().map((target) => target.label)).toEqual([
      'cluster',
      'provisioning',
      'claimed'
    ])
    expect(sshStore.getTarget(claimed.id)?.owner).toBeUndefined()
  })

  it('keeps ~/.ssh/config sync from rewriting a claimed config-sourced host', async () => {
    mockStore.addSshTarget({
      ...base,
      id: 'ssh-config-host',
      configHost: 'cluster',
      source: 'ssh-config',
      occdFence: { environmentId: 'environment-1' }
    })
    loadUserSshConfigMock.mockReturnValue([{ host: 'cluster' }])
    sshConfigHostsToTargetsMock.mockReturnValue([
      { ...base, id: 'tmp', configHost: 'cluster', host: '10.0.0.9', port: 2222 }
    ])

    expect((await sshStore.importFromSshConfig()).targets).toEqual([])
    expect(mockStore.updateSshTarget).not.toHaveBeenCalled()
  })

  it('tells a managed host apart from a runtime-owned one', () => {
    const target = { ...base, id: 'ssh-1' }
    const provisioning = { ...target, occdProvisioning: { requestId: 'r', name: 'n' } }
    const fenced = { ...target, occdFence: { environmentId: 'e' } }
    expect(isManagedOCCdSshTarget(target)).toBe(false)
    expect(isManagedOCCdSshTarget(provisioning)).toBe(true)
    expect(isManagedOCCdSshTarget(fenced)).toBe(true)
    expect(isRuntimeOwnedSshTarget(fenced)).toBe(false)
    expect(
      isRuntimeOwnedSshTarget({ ...target, owner: { type: 'on-demand-runtime', runtimeId: 'vm' } })
    ).toBe(true)
  })
})
