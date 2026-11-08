import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import type * as ActiveProbe from './wsl-occd-active-probe'
import type * as ManagedRuntimeContext from '../../managed-server/lifecycle/occd-managed-runtime-context'
import type * as RemoteVersionedInstall from '../../managed-server/install/remote-versioned-install'
import { emptyOCCdActivationRecord } from '../../managed-server/activation/occd-activation-record'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { OCCdActiveReadinessError } from '../../ssh/occd-active-readiness'
import { WslDistroNotRunningError } from './wsl-occd-connection-errors'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
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
vi.mock('../../managed-server/activation/occd-activation-transaction-store', () => ({
  readOCCdActivationTransaction: mocks.transaction
}))
vi.mock('../../managed-server/activation/occd-activation-record-store', () => ({
  readOCCdActivationRecord: mocks.readRecord,
  occdActivationPath: (_host: unknown, home: string) => `${home}/.occ-remote/occd-active.json`
}))
vi.mock('../../managed-server/install/remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<typeof RemoteVersionedInstall>()),
  readLocalFullVersion: mocks.localVersion
}))
vi.mock('./wsl-occd-instance-adoption', () => ({ adoptUnrecordedWslOCCd: mocks.adopt }))
vi.mock('../../ssh/occd-running-version-adoption', () => ({
  adoptRunningOCCdVersion: mocks.adoptRunning
}))

vi.mock('../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getVersion: () => '1.5.0', getPath: () => '/user-data' })
}))
vi.mock('../../ssh/remote-exec/remote-exec-command', () => ({ execCommand: mocks.exec }))
vi.mock('../../managed-server/install/occd-remote-context', () => ({
  resolveOCCdRemoteContext: mocks.resolveContext
}))
vi.mock('../../managed-server/activation/occd-activation-recovery', () => ({
  recoverInterruptedOCCdActivation: mocks.recover
}))
vi.mock('../../occd/occd-artifact-materializer', () => ({
  materializeOCCdArtifact: async () => '/local/occd'
}))
vi.mock('../../ssh/occd-remote-deploy', () => ({ deployOCCd: mocks.deploy }))
vi.mock('./wsl-occd-active-probe', async (importOriginal) => ({
  ...(await importOriginal<typeof ActiveProbe>()),
  probeWslActiveOCCd: async (...args: unknown[]) => ({
    readiness: await mocks.probe(...args),
    pid: 4242
  })
}))
vi.mock('../../managed-server/lifecycle/occd-managed-version-gc', () => ({
  provenLiveDaemonVersion: () => null,
  pruneManagedOCCdVersions: mocks.prune,
  pruneSupersededOCCdCandidates: async () => {}
}))
vi.mock('../../managed-server/lifecycle/occd-managed-wake', () => ({
  wakeStoppedManagedOCCd: mocks.wake
}))
vi.mock('../../managed-server/lifecycle/occd-managed-runtime-context', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedRuntimeContext>()),
  probeManagedOCCdReadiness: mocks.probe
}))

import { deployAndLaunchWslOCCd } from './wsl-occd-deploy'
import { resetOCCdUpdateFailuresForTests } from '../../managed-server/lifecycle/occd-managed-update-failure-memory'

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

function transport(target: WslOCCdHostTarget): OCCdHostTransport {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every host call is mocked at its module.
  return { getTarget: () => target } as unknown as OCCdHostTransport
}
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

  it('refuses to deploy or launch when an unrecorded occd cannot be proven', async () => {
    mocks.adopt.mockRejectedValueOnce(
      Object.assign(new Error('cannot be identified'), { name: 'WslOCCdUnrecordedInstanceError' })
    )
    await expect(launch()).rejects.toMatchObject({ name: 'WslOCCdUnrecordedInstanceError' })
    expect(mocks.deploy).not.toHaveBeenCalled()
    expect(mocks.wake).not.toHaveBeenCalled()
  })
})
