import { describe, expect, it } from 'vitest'
import {
  getLegacyManagedOCCdOwnerEnvironmentId,
  getManagedOCCdFenceEnvironmentId,
  isEphemeralRuntimeSshOwner,
  managedOCCdServerName
} from './managed-occd-ssh-owner'

describe('managed occd SSH fence', () => {
  it('reads the fence from occdFence, never from owner', () => {
    expect(getManagedOCCdFenceEnvironmentId({ occdFence: { environmentId: 'env-1' } })).toBe(
      'env-1'
    )
    const legacyOnly = {
      occdFence: undefined,
      owner: { type: 'on-demand-runtime' as const, runtimeId: 'managed-occd:old' }
    }
    expect(getManagedOCCdFenceEnvironmentId({ ...legacyOnly })).toBeNull()
    expect(
      getManagedOCCdFenceEnvironmentId({ ...legacyOnly, occdFence: { environmentId: 'env-2' } })
    ).toBe('env-2')
    expect(getManagedOCCdFenceEnvironmentId(undefined)).toBeNull()
  })

  it('recognises the legacy owner fence only so loading can migrate it', () => {
    const legacy = { type: 'on-demand-runtime' as const, runtimeId: 'managed-occd:env-1' }
    expect(getLegacyManagedOCCdOwnerEnvironmentId(legacy)).toBe('env-1')
    expect(isEphemeralRuntimeSshOwner(legacy)).toBe(false)
  })

  it('keeps ordinary on-demand runtime targets ephemeral', () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-1' }
    expect(getLegacyManagedOCCdOwnerEnvironmentId(owner)).toBeNull()
    expect(isEphemeralRuntimeSshOwner(owner)).toBe(true)
  })

  it("names a recipe VM's server after its runtime, so two VMs of one recipe never collide", () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-0123456789abcdef' }
    expect(managedOCCdServerName({ label: 'Docker root', owner })).toBe('Docker root VM 89abcdef')
    expect(
      managedOCCdServerName({
        label: 'Docker root',
        owner: { ...owner, runtimeId: 'runtime-fedcba9876543210' }
      })
    ).toBe('Docker root VM 76543210')
    expect(managedOCCdServerName({ label: 'Builder' })).toBe('Builder')
  })
})
