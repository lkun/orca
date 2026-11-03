import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as VersionGc from '../managed-server/lifecycle/occd-managed-version-gc'
import type * as RemoteVersionedInstall from '../managed-server/install/remote-versioned-install'

const mocks = vi.hoisted(() => ({
  installed: new Set<string>(),
  record: vi.fn(),
  readiness: vi.fn(),
  pins: vi.fn(),
  inUse: vi.fn(async () => false),
  remove: vi.fn(),
  fenceHeld: false
}))

vi.mock('../managed-server/activation/occd-activation-record-store', () => ({
  readOCCdActivationRecord: mocks.record
}))
vi.mock('../managed-server/lifecycle/occd-managed-version-gc', async (importOriginal) => ({
  ...(await importOriginal<typeof VersionGc>()),
  probeOCCdSlotReadiness: mocks.readiness
}))
vi.mock('../ssh/occd-gc-transaction-pins', () => ({ readOCCdGcTransactionPins: mocks.pins }))
vi.mock('./wsl-occd-slot-process-probe', () => ({ isWslOCCdSlotInUse: mocks.inUse }))
// One activation fence per host: a second taker is told it is held, as the real lock does after its wait.
vi.mock('../managed-server/activation/occd-activation-lock', () => ({
  withOCCdActivationLock: async <T>(_slot: unknown, run: () => Promise<T>, held: () => T) => {
    if (mocks.fenceHeld) {
      return held()
    }
    mocks.fenceHeld = true
    try {
      return await run()
    } finally {
      mocks.fenceHeld = false
    }
  }
}))
vi.mock('../managed-server/install/remote-install-gc', () => ({
  removeRemoteInstallVersionDir: mocks.remove
}))
// The install itself runs for real against a host whose only state is which slots are complete.
vi.mock('../managed-server/install/remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<typeof RemoteVersionedInstall>()),
  isRemoteInstallComplete: async (_conn: unknown, _model: unknown, dir: string) =>
    mocks.installed.has(dir),
  finalizeInstall: async (_conn: unknown, dir: string) => void mocks.installed.add(dir),
  abandonInstall: async () => true
}))
vi.mock('../managed-server/install/remote-install-lock', () => ({
  acquireInstallLock: vi.fn(async () => {})
}))
vi.mock('../managed-server/install/remote-install-transfers', () => ({
  uploadRemoteInstallDirectory: vi.fn(async () => {}),
  writeRemoteInstallFile: vi.fn(async () => {})
}))
vi.mock('../managed-server/install/occd-remote-node-runtime', () => ({
  ensureRemoteOCCdNodeRuntime: vi.fn(async () => {})
}))
vi.mock('../ssh/remote-exec/remote-exec-command', () => ({
  execCommand: vi.fn(async () => ''),
  isUnconfirmedSshCommandTermination: () => false
}))

import { removeFailedFreshWslOCCdInstall } from './wsl-occd-failed-install-removal'
import { withOCCdActivationLock } from '../managed-server/activation/occd-activation-lock'
import { installOCCdBundle } from '../managed-server/install/occd-remote-install'
import { uploadRemoteInstallDirectory } from '../managed-server/install/remote-install-transfers'
import {
  emptyOCCdActivationRecord,
  withActivatedVersion
} from '../managed-server/activation/occd-activation-record'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type { OCCdDeployResult } from '../ssh/occd-remote-deploy'

const NEW = '1.6.0+bb01'
const OLD = '1.5.0+aa01'
const NEW_DIR = `/home/u/.occ-remote/occd-${NEW}`
const host = getRemoteHostPlatform('linux-x64')
const slot = {
  conn: Object.create(null),
  host,
  remoteHome: '/home/u',
  nodePath: '/usr/bin/node',
  userDataDir: '/home/u/.occ',
  bindHost: '127.0.0.1',
  port: 6768
}
const failedFresh: OCCdDeployResult = {
  outcome: 'installed-not-activated',
  fullVersion: NEW,
  code: 'occd_activation_daemon_degraded',
  reason: 'the candidate failed its readiness check',
  startCheckFailed: true,
  freshlyInstalled: true
}

function install(): Promise<'uploaded' | 'reused'> {
  return installOCCdBundle(
    {
      ...slot,
      localOCCdDir: '/local/occd',
      target: 'linux-x64-glibc',
      nodeRuntimeArchive: async () => '/cache/node.tar.gz'
    },
    NEW,
    NEW_DIR
  )
}

function daemon(state: 'live' | 'absent' | 'degraded', buildVersion = OLD) {
  return { health: { terminalDaemon: { state, buildVersion } } }
}

describe('removeFailedFreshWslOCCdInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.installed.clear()
    mocks.fenceHeld = false
    mocks.record.mockResolvedValue(
      withActivatedVersion(emptyOCCdActivationRecord(), OLD, null, new Date(0))
    )
    mocks.readiness.mockResolvedValue(daemon('live'))
    mocks.pins.mockResolvedValue({ state: 'pinned', dirNames: [] })
    mocks.remove.mockImplementation(async (_conn: unknown, _model: unknown, dir: string) =>
      mocks.installed.delete(dir)
    )
  })

  it('removes a slot this connect uploaded once its candidate fails, so the retry uploads again', async () => {
    expect(await install()).toBe('uploaded')

    await removeFailedFreshWslOCCdInstall(slot, failedFresh)

    expect(mocks.remove).toHaveBeenCalledWith(slot.conn, expect.anything(), NEW_DIR, host, {
      isDirLive: expect.any(Function)
    })
    expect(mocks.installed.has(NEW_DIR)).toBe(false)
    expect(await install()).toBe('uploaded')
    expect(uploadRemoteInstallDirectory).toHaveBeenCalledTimes(2)
  })

  it('checks and deletes under the activation fence, so a concurrent activator waits and re-uploads', async () => {
    await install()
    let resume = (): void => {}
    mocks.record.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resume = resolve
      })
      return emptyOCCdActivationRecord()
    })
    const removal = removeFailedFreshWslOCCdInstall(slot, failedFresh)
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalled())

    // Another connect reaching activation between the check and the delete finds the fence held.
    const activator = await withOCCdActivationLock(
      slot,
      async () => 'launched',
      () => 'held'
    )
    expect(activator).toBe('held')
    resume()
    await removal

    expect(mocks.pins).toHaveBeenCalledWith(slot, { callerHoldsFence: true })
    expect(mocks.installed.has(NEW_DIR)).toBe(false)
    expect(await install()).toBe('uploaded')
  })

  it('keeps the copy when another activator already holds the fence', async () => {
    await install()
    mocks.fenceHeld = true

    await removeFailedFreshWslOCCdInstall(slot, failedFresh)

    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(await install()).toBe('reused')
  })

  it('asks the slot process probe, which also sees a daemon the candidate left there', async () => {
    await removeFailedFreshWslOCCdInstall(slot, failedFresh)
    const [, , , , { isDirLive }] = mocks.remove.mock.calls[0]
    mocks.inUse.mockResolvedValueOnce(true)

    await expect(isDirLive(NEW_DIR)).resolves.toBe(true)
    expect(mocks.inUse).toHaveBeenCalledWith(slot, NEW_DIR)
  })

  it('also removes a failed first install, where nothing is active', async () => {
    mocks.record.mockResolvedValue(emptyOCCdActivationRecord())
    await install()

    await removeFailedFreshWslOCCdInstall(slot, failedFresh)

    expect(mocks.readiness).not.toHaveBeenCalled()
    expect(mocks.installed.has(NEW_DIR)).toBe(false)
  })

  it('never touches a slot that was already installed before this connect', async () => {
    mocks.installed.add(NEW_DIR)
    expect(await install()).toBe('reused')

    await removeFailedFreshWslOCCdInstall(slot, { ...failedFresh, freshlyInstalled: undefined })

    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(await install()).toBe('reused')
  })

  it('keeps a deferred update staged for later', async () => {
    await removeFailedFreshWslOCCdInstall(slot, { ...failedFresh, startCheckFailed: undefined })
    await removeFailedFreshWslOCCdInstall(slot, { outcome: 'already-active', fullVersion: NEW })

    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it.each([
    [
      'is the active version',
      withActivatedVersion(emptyOCCdActivationRecord(), NEW, null, new Date(0))
    ],
    [
      'is the rollback target',
      withActivatedVersion(
        withActivatedVersion(emptyOCCdActivationRecord(), NEW, null, new Date(0)),
        OLD,
        null,
        new Date(1)
      )
    ]
  ])('never removes a slot that %s', async (_label, record) => {
    mocks.record.mockResolvedValue(record)

    await removeFailedFreshWslOCCdInstall(slot, failedFresh)

    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it.each([
    ['runs a live terminal daemon from it', daemon('live', NEW)],
    ['cannot name its terminal daemon build', daemon('degraded')]
  ])('keeps the slot while the serving version %s', async (_label, readiness) => {
    mocks.readiness.mockResolvedValue(readiness)

    await removeFailedFreshWslOCCdInstall(slot, failedFresh)

    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it.each([
    ['a held fence or unreadable journal', { state: 'keep-all' }],
    ['a journaled activation', { state: 'pinned', dirNames: [`occd-${NEW}`] }]
  ])('keeps the slot that %s may still need', async (_label, pins) => {
    mocks.pins.mockResolvedValue(pins)

    await removeFailedFreshWslOCCdInstall(slot, failedFresh)

    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('leaves the failed connect to report its own reason when cleanup fails', async () => {
    mocks.readiness.mockRejectedValue(new Error('probe timed out'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(removeFailedFreshWslOCCdInstall(slot, failedFresh)).resolves.toBeUndefined()

    expect(mocks.remove).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
