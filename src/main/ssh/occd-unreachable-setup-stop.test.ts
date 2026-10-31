import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyOCCdActivationRecord } from '../managed-server/activation/occd-activation-record'

const mocks = vi.hoisted(() => {
  const record: { active: string | null } = { active: '1.0.0+a' }
  return { stop: vi.fn(), write: vi.fn(), release: vi.fn(), record }
})
vi.mock('../../shared/runtime-environment-store', () => ({ listEnvironments: () => [] }))
vi.mock('../../shared/runtime-environment-managed-occd-store', () => ({
  removeManagedOCCdEnvironment: vi.fn()
}))
vi.mock('./occd-migration-cutover-journal', () => ({
  findOCCdMigrationSourceCutoverForTarget: () => ({
    phase: 'source-fenced',
    destinationEnvironmentId: 'env-1'
  })
}))
vi.mock('./occd-migration-source-fence', () => ({
  releaseUndeployedMigrationFence: mocks.release
}))
vi.mock('../managed-server/lifecycle/occd-managed-tunnel', () => ({
  closeOCCdManagedTunnel: async () => undefined
}))
vi.mock('./targets/ssh-target-registry', () => ({
  getSshTargetRegistryStore: () => ({ getTarget: () => ({ id: 'ssh-1' }) }),
  getSshConnectionManager: () => ({ connect: async () => ({}) })
}))
vi.mock('../managed-server/install/occd-remote-context', () => ({
  resolveOCCdRemoteContext: async () => ({
    activationRecord: { ...emptyOCCdActivationRecord(), active: mocks.record.active },
    connection: {},
    host: { os: 'linux' },
    remoteHome: '/home/u',
    userDataDir: '/home/u/.occ'
  })
}))
vi.mock('../managed-server/activation/occd-activation-lock', () => ({
  withOCCdActivationLock: async (_options: unknown, run: () => Promise<unknown>) => run()
}))
vi.mock('../managed-server/activation/occd-activation-record-store', () => ({
  readOCCdActivationRecord: async () => ({
    ...emptyOCCdActivationRecord(),
    active: mocks.record.active
  }),
  writeOCCdActivationRecord: mocks.write
}))
vi.mock('./occd-recovery-slot', () => ({
  occdSlotDir: (_slot: unknown, version: string) => `/slots/${version}`,
  stopOCCdSlot: mocks.stop
}))

const { releaseUnreachableOCCdSetup } = await import('./occd-unreachable-setup-release')
const release = () =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: claims pass through to the mocked fence release only.
  releaseUnreachableOCCdSetup({ userDataPath: '/u', claims: {} as never, targetId: 'ssh-1' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.record.active = '1.0.0+a'
})

describe('releasing an unreachable setup', () => {
  it('stops the occd it activated and clears active only on proven exit', async () => {
    mocks.stop.mockResolvedValueOnce('stopped')
    await release()
    expect(mocks.stop).toHaveBeenCalledWith(expect.anything(), '/slots/1.0.0+a', false)
    expect(mocks.write.mock.calls[0]?.[1]).toMatchObject({ active: null, previous: '1.0.0+a' })
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('keeps the record when the stop is not proven, and still releases the fence', async () => {
    mocks.stop.mockResolvedValueOnce('unconfirmed')
    await release()
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('touches nothing on a host whose setup never activated', async () => {
    mocks.record.active = null
    await release()
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
