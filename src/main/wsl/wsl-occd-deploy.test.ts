import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OCCdHostTransport } from '../ssh/occd-host-transport'
import type * as ActiveProbe from './wsl-occd-active-probe'
import type * as ManagedRuntimeContext from '../managed-server/lifecycle/occd-managed-runtime-context'
import type * as RemoteVersionedInstall from '../managed-server/install/remote-versioned-install'
import { emptyOCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { OCCdActiveReadinessError } from '../ssh/occd-active-readiness'
import { WslDistroNotRunningError } from './wsl-occd-connection-errors'
import type { WslDistroHolder } from './wsl-distro-holder'
import type { WslOCCdHostTarget } from './wsl-occd-host-target'

const mocks = vi.hoisted(() => ({
  steps: new Array<string>(),
  exec: vi.fn(),
  resolveContext: vi.fn(),
  recover: vi.fn(),
  deploy: vi.fn(),
  probe: vi.fn(),
  prune: vi.fn(),
  wake: vi.fn(),
  adopt: vi.fn(),
  incumbent: vi.fn(),
  adoptRunning: vi.fn(),
  localVersion: vi.fn(),
  readRecord: vi.fn(),
  removeFailed: vi.fn(),
  transaction: vi.fn(async (): Promise<unknown> => null)
}))
vi.mock('./wsl-occd-failed-install-removal', () => ({
  removeFailedFreshWslOCCdInstall: mocks.removeFailed
}))
vi.mock('../managed-server/activation/occd-activation-transaction-store', () => ({
  readOCCdActivationTransaction: mocks.transaction
}))
vi.mock('../managed-server/activation/occd-activation-record-store', () => ({
  readOCCdActivationRecord: mocks.readRecord,
  occdActivationPath: (_host: unknown, home: string) => `${home}/.occ-remote/occd-active.json`
}))
vi.mock('../managed-server/install/remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<typeof RemoteVersionedInstall>()),
  readLocalFullVersion: mocks.localVersion
}))
vi.mock('./wsl-occd-instance-adoption', () => ({ adoptUnrecordedWslOCCd: mocks.adopt }))
vi.mock('../ssh/occd-running-version-adoption', () => ({
  adoptRunningOCCdVersion: mocks.adoptRunning
}))

vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getVersion: () => '1.5.0', getPath: () => '/user-data' })
}))
vi.mock('../ssh/remote-exec/remote-exec-command', () => ({ execCommand: mocks.exec }))
vi.mock('../managed-server/install/occd-remote-context', () => ({
  resolveOCCdRemoteContext: mocks.resolveContext
}))
vi.mock('../managed-server/activation/occd-activation-recovery', () => ({
  recoverInterruptedOCCdActivation: mocks.recover
}))
vi.mock('../occd/occd-artifact-materializer', () => ({
  materializeOCCdArtifact: async () => '/local/occd'
}))
vi.mock('../ssh/occd-remote-deploy', () => ({ deployOCCd: mocks.deploy }))
vi.mock('./wsl-occd-active-probe', async (importOriginal) => ({
  ...(await importOriginal<typeof ActiveProbe>()),
  probeWslActiveOCCd: async (...args: unknown[]) => ({
    readiness: await mocks.probe(...args),
    pid: 4242
  })
}))
vi.mock('../managed-server/lifecycle/occd-managed-version-gc', () => ({
  provenLiveDaemonVersion: () => null,
  pruneManagedOCCdVersions: mocks.prune,
  pruneSupersededOCCdCandidates: async () => {}
}))
vi.mock('../managed-server/lifecycle/occd-managed-wake', () => ({
  wakeStoppedManagedOCCd: mocks.wake
}))
vi.mock('../managed-server/lifecycle/occd-managed-runtime-context', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedRuntimeContext>()),
  probeManagedOCCdReadiness: mocks.probe
}))

import { deployAndLaunchWslOCCd } from './wsl-occd-deploy'
import { resetOCCdUpdateFailuresForTests } from '../managed-server/lifecycle/occd-managed-update-failure-memory'

beforeEach(() => resetOCCdUpdateFailuresForTests())

const host = getRemoteHostPlatform('linux-x64')
const READINESS = {
  runtimeId: 'r1',
  boundEndpoint: 'ws://127.0.0.1:6790',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled' as const,
  pairing: { available: false as const, reason: 'disabled_by_operator', guidance: '' }
}

function holder(): WslDistroHolder {
  return {
    ensureHeld: vi.fn(async (distro: string) => {
      mocks.steps.push(`hold:${distro}`)
      return {
        outcome: 'spawned' as const,
        record: { version: 1 as const, distro, pid: 9, creationTimeMs: 1, startedAtMs: 1 }
      }
    }),
    adoptHolders: vi.fn(),
    release: vi.fn(),
    releaseAll: vi.fn(),
    holderState: vi.fn()
  }
}

let seenTarget: WslOCCdHostTarget | null = null
function transport(target: WslOCCdHostTarget): OCCdHostTransport {
  seenTarget = target
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every host call is mocked at its module.
  return { getTarget: () => target } as unknown as OCCdHostTransport
}

const section = (text: string) => `${text}\n__OCC_WSL_CONNECT_STATE_END__\n`
let snapshotAnswer = ''

function launch(kernel = '5.15.167.4-microsoft-standard-WSL2', options = {}) {
  mocks.exec.mockImplementation(async (_conn: unknown, command: string) => {
    if (command.includes('uname -r')) {
      mocks.steps.push('uname')
      return `__OCC_WSL_KERNEL__ ${kernel}\n__OCC_WSL_HOME__ /home/u\n\n__OCC_REMOTE_PLATFORM__ Linux x86_64\n\n__OCC_WSL_LIBC__\nldd (GNU libc) 2.39\n`
    }
    return command.includes('CONNECT_STATE_END') ? snapshotAnswer : '4242\n'
  })
  return deployAndLaunchWslOCCd('Ubuntu-24.04', {
    holder: holder(),
    createTransport: transport,
    readRegistryId: async () => '0283592d-be56-40d4-b935-3dc18c3aa007',
    readIncumbent: mocks.incumbent,
    ...options
  })
}

describe('deployAndLaunchWslOCCd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.steps.length = 0
    seenTarget = null
    mocks.resolveContext.mockImplementation(async (target: WslOCCdHostTarget, connection) => {
      mocks.steps.push('context')
      return {
        activationRecord: emptyOCCdActivationRecord(),
        serverTarget: 'linux-x64-glibc',
        connection,
        host,
        remoteHome: '/home/u',
        target,
        userDataDir: '/home/u/.occ'
      }
    })
    mocks.recover.mockResolvedValue({ outcome: 'none' })
    mocks.adopt.mockImplementation(async () => {
      mocks.steps.push('adopt-check')
      return { outcome: 'none' }
    })
    mocks.deploy.mockImplementation(async () => {
      mocks.steps.push('deploy+launch')
      return { outcome: 'installed-and-activated', fullVersion: '1.5.0+ab', verdict: {} }
    })
    mocks.probe.mockResolvedValue(READINESS)
    mocks.localVersion.mockReturnValue('1.5.0+ab')
    mocks.incumbent.mockResolvedValue({
      census: {
        liveSessions: null,
        startedSinceActivation: null,
        daemonProtocolVersion: null
      },
      readiness: null
    })
  })

  it('holds the distro before it deploys and launches, and reports what C5 dials', async () => {
    await expect(launch()).resolves.toEqual({
      outcome: 'ready',
      distro: 'Ubuntu-24.04',
      distroId: '0283592d-be56-40d4-b935-3dc18c3aa007',
      port: 6790,
      fullVersion: '1.5.0+ab',
      pid: 4242,
      readiness: READINESS,
      holder: 'spawned'
    })
    expect(mocks.steps).toEqual([
      'uname',
      'hold:Ubuntu-24.04',
      'context',
      'adopt-check',
      'deploy+launch'
    ])
    expect(seenTarget).toEqual({
      kind: 'wsl',
      id: 'wsl:ubuntu-24.04',
      distro: 'Ubuntu-24.04',
      label: 'Ubuntu-24.04'
    })
    // The serving probe read the pid; nothing reads it again.
    expect(
      mocks.exec.mock.calls.some(([, command]) => String(command).includes('.occd-pid'))
    ).toBe(false)
  })

  it.each([
    ['nothing pending', 'ABSENT', 'OPEN', { transactionAbsent: true, fenceOpen: true }],
    ['a held fence', 'ABSENT', 'LOCKED', { transactionAbsent: true, fenceOpen: false }],
    ['a pending journal', 'PRESENT\n{}', 'OPEN', { transactionAbsent: false, fenceOpen: true }]
  ])('passes its connect-state read (%s) on as hints', async (_, journal, fence, preRead) => {
    snapshotAnswer = `${section('ABSENT')}${section(journal)}${section('ABSENT')}${section('NONE')}${fence}\n`
    const resolve = mocks.resolveContext.getMockImplementation()
    mocks.resolveContext.mockImplementationOnce(async (target, connection, signal, h, known) => {
      const context = await resolve?.(target, connection, signal, h, known)
      const at = { conn: connection, host, remoteHome: '/home/u', userDataDir: '/home/u/.occ' }
      return { ...context, activationRecord: await known.readActivationRecord(at) }
    })
    await launch()
    // Recovery reads the host unless both are idle; deploy re-probes a fence seen held.
    expect(mocks.recover.mock.calls[0][1]).toMatchObject(preRead)
    expect(mocks.adopt.mock.calls[0][3]).toEqual({ state: 'absent' })
    expect(mocks.deploy.mock.calls[0][0].preRead.fenceOpen).toBe(preRead.fenceOpen)
  })

  it('applies the SSH census and downgrade admission to the first deploy', async () => {
    await launch()
    const options = mocks.deploy.mock.calls[0][0]
    expect(options).toMatchObject({
      census: { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null },
      appVersion: '1.5.0',
      localOCCdDir: '/local/occd',
      target: 'linux-x64-glibc',
      recordedNodeRuntimeProbe: true,
      // A dropped network fails a first deploy in well under a minute.
      nodeRuntimeDownload: { desktopConnectTimeoutMs: 15_000, hostConnectTimeoutSeconds: 15 }
    })
    expect(options.preRead).toBeUndefined()
    const newer = { ...emptyOCCdActivationRecord(), active: '2.0.0+cd', activeAppVersion: '2.0.0' }
    expect(options.admitRecord(newer, '1.5.0+ab')).toBe(
      "OCC 2.0.0 last ran this host's server, newer than this OCC (1.5.0). Update OCC to start it."
    )
  })

  it('refuses a WSL 1 distro before holding it or touching its files', async () => {
    await expect(launch('4.4.0-19041-Microsoft')).rejects.toMatchObject({
      name: 'OCCdHostUnsupportedError',
      message: expect.stringContaining('wsl --set-version Ubuntu-24.04 2')
    })
    expect(mocks.steps).toEqual(['uname'])
  })

  it('tells an unregistered distro how to find the installed ones, before holding anything', async () => {
    mocks.exec.mockImplementation(async () => {
      mocks.steps.push('uname')
      throw new Error(
        'Command "uname -r" failed (exit 1): There is no distribution with the supplied name.\n' +
          'Error code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND'
      )
    })
    await expect(
      deployAndLaunchWslOCCd('Gone', { holder: holder(), createTransport: transport })
    ).rejects.toMatchObject({
      name: 'OCCdHostUnsupportedError',
      message: expect.stringContaining('wsl --list --verbose')
    })
    expect(mocks.steps).toEqual(['uname'])
  })

  it('surfaces an unsupported libc as the SSH host refusal does', async () => {
    const refusal = Object.assign(
      new Error('No OCC runtime supports linux-x64-glibc with glibc 2.17.'),
      {
        name: 'OCCdHostUnsupportedError'
      }
    )
    mocks.resolveContext.mockRejectedValueOnce(refusal)
    await expect(launch()).rejects.toBe(refusal)
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('starts an already-active slot the distro stop ended, instead of reporting it ready', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'started', readiness: READINESS })
    await expect(launch()).resolves.toMatchObject({ outcome: 'ready', port: 6790 })
    expect(mocks.wake).toHaveBeenCalledTimes(1)
  })

  it('does not wake again when a no-boot connect finds the distro stopped meanwhile', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    mocks.probe.mockRejectedValueOnce(new OCCdActiveReadinessError('exited', 'process has exited'))
    const requireRunning = vi.fn(async () => false)
    await expect(launch(undefined, { requireRunning })).rejects.toBeInstanceOf(
      WslDistroNotRunningError
    )
    expect(requireRunning).toHaveBeenCalledOnce()
    expect(mocks.wake).toHaveBeenCalledTimes(1)
  })

  // Real host (win-lowspec, cold systemd distro): the occd the wake saw serving exited before the probe.
  it('starts the slot again when the occd the wake saw serving exits before the probe', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'started', readiness: READINESS })
    mocks.probe.mockRejectedValueOnce(new OCCdActiveReadinessError('exited', 'process has exited'))
    await expect(launch()).resolves.toMatchObject({ outcome: 'ready', port: 6790 })
    expect(mocks.wake).toHaveBeenCalledTimes(2)

    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    const refused = new OCCdActiveReadinessError('rejected', 'wrong build')
    mocks.probe.mockRejectedValueOnce(refused)
    await expect(launch()).rejects.toBe(refused)
    expect(mocks.wake).toHaveBeenCalledTimes(3)
  })

  // Reproduce failed Remove leaving serving occd absent from the activation record.
  it('deploys over an adopted unrecorded occd under the SSH terminal gate, never a fresh launch', async () => {
    const adoptedRecord = {
      ...emptyOCCdActivationRecord(),
      active: '0.1.0+aa',
      activatedAt: '2026-10-12T01:00:00.000Z'
    }
    mocks.adopt.mockResolvedValueOnce({
      outcome: 'adopted',
      version: '0.1.0+aa',
      pid: 500,
      record: adoptedRecord
    })
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: '1.5.0+ab',
      code: 'occd_update_terminal_census_unavailable',
      reason: 'unknown census'
    })
    await expect(launch()).resolves.toMatchObject({ outcome: 'deferred', forceable: false })
    expect(mocks.deploy.mock.calls[0][0]).toMatchObject({
      censusRecord: adoptedRecord,
      census: { liveSessions: null, startedSinceActivation: null, daemonProtocolVersion: null }
    })
  })

  it('reports the adopted instance once the same version is serving', async () => {
    mocks.adopt.mockResolvedValueOnce({
      outcome: 'adopted',
      version: '1.5.0+ab',
      pid: 500,
      record: { ...emptyOCCdActivationRecord(), active: '1.5.0+ab' }
    })
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: '1.5.0+ab' })
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    await expect(launch()).resolves.toMatchObject({
      outcome: 'ready',
      adoptedInstance: { version: '1.5.0+ab', pid: 500 }
    })
  })

  it('refuses to deploy or launch when an unrecorded occd cannot be proven', async () => {
    mocks.adopt.mockRejectedValueOnce(
      Object.assign(new Error('cannot be identified'), { name: 'WslOCCdUnrecordedInstanceError' })
    )
    await expect(launch()).rejects.toMatchObject({ name: 'WslOCCdUnrecordedInstanceError' })
    expect(mocks.deploy).not.toHaveBeenCalled()
    expect(mocks.wake).not.toHaveBeenCalled()
  })

  it('returns a deferral rather than launching over live terminals', async () => {
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: '1.6.0+ef',
      code: 'occd_update_terminals_running',
      reason: 'terminals are running'
    })
    await expect(launch()).resolves.toEqual({
      outcome: 'deferred',
      distro: 'Ubuntu-24.04',
      candidateVersion: '1.6.0+ef',
      code: 'occd_update_terminals_running',
      reason: 'terminals are running',
      forceable: true
    })
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it('hands a failed first deploy to the fresh-install cleanup before reporting it', async () => {
    const failed = {
      outcome: 'installed-not-activated',
      fullVersion: '1.5.0+ab',
      code: 'occd_activation_daemon_degraded',
      reason: 'the candidate failed its readiness check',
      startCheckFailed: true,
      freshlyInstalled: true
    }
    mocks.deploy.mockResolvedValueOnce(failed)
    await expect(launch()).resolves.toMatchObject({
      outcome: 'deferred',
      candidateVersion: '1.5.0+ab'
    })
    expect(mocks.removeFailed).toHaveBeenCalledWith(
      expect.objectContaining({ remoteHome: '/home/u' }),
      failed
    )
    expect(mocks.probe).not.toHaveBeenCalled()
  })
})
