import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stale: vi.fn(),
  journal: vi.fn(),
  fence: vi.fn(),
  takeover: vi.fn()
}))
vi.mock('../install/remote-install-lock', () => ({
  isRelayInstallLockStale: mocks.stale,
  RELAY_INSTALL_LOCK_NAME: '.install-lock'
}))
vi.mock('./occd-activation-transaction-store', () => ({
  readOCCdActivationTransaction: mocks.journal
}))
vi.mock('./occd-activation-lock', () => ({
  occdActivationFenceExists: mocks.fence,
  withStaleOCCdActivationRecoveryLock: mocks.takeover
}))

const { occdActivationFenceRefusal } = await import('./occd-activation-fence-hold')
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every reader of these options is mocked.
const options = { host: { os: 'linux', pathFlavor: 'posix' }, remoteHome: '/home/u' } as never

beforeEach(() => {
  vi.resetAllMocks()
  mocks.stale.mockResolvedValue(false)
  mocks.journal.mockResolvedValue(null)
  mocks.fence.mockResolvedValue(true)
  mocks.takeover.mockImplementation(async (_options, run) => run({ retain: vi.fn() }))
})

describe('occdActivationFenceRefusal', () => {
  it('reads a fresh fence as busy, even over a live run journal', async () => {
    mocks.journal.mockResolvedValue({ operation: 'activate' })
    await expect(occdActivationFenceRefusal(options, 'update')).resolves.toMatchObject({
      code: 'occd_activation_fence_busy'
    })
  })

  it('asks for Recover only for a stale lock over a journal, or a journal no fence guards', async () => {
    mocks.journal.mockResolvedValue({ operation: 'activate' })
    mocks.stale.mockResolvedValueOnce(true)
    await expect(occdActivationFenceRefusal(options, 'update')).resolves.toMatchObject({
      code: 'occd_activation_recovery_required'
    })
    mocks.fence.mockResolvedValue(false)
    await expect(occdActivationFenceRefusal(options, 'update')).resolves.toMatchObject({
      code: 'occd_activation_recovery_required'
    })
    expect(mocks.takeover).not.toHaveBeenCalled()
  })

  it('clears a stale fence no journal backs, so the attempt can run again', async () => {
    mocks.stale.mockResolvedValue(true)
    await expect(occdActivationFenceRefusal(options, 'update')).resolves.toMatchObject({
      code: 'occd_activation_fence_busy',
      cleared: true
    })
    expect(mocks.takeover).toHaveBeenCalledOnce()
  })

  it('keeps a fence whose journal appeared under the takeover, and asks for Recover', async () => {
    mocks.stale.mockResolvedValue(true)
    mocks.journal.mockResolvedValueOnce(null).mockResolvedValue({ operation: 'activate' })
    const retain = vi.fn()
    mocks.takeover.mockImplementation(async (_options, run) => run({ retain }))
    await expect(occdActivationFenceRefusal(options, 'update')).resolves.toMatchObject({
      code: 'occd_activation_recovery_required'
    })
    expect(retain).toHaveBeenCalledOnce()
  })
})
