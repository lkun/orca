import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OCCD_UPDATE_ADMISSION_STOP_BY_MS } from '../../../shared/occd-terminal-census'
import type * as RecordFile from './occd-remote-record-file'
import type * as InstallLock from './remote-install-lock'
import type * as TerminalBarrier from '../lifecycle/occd-rollback-terminal-barrier'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('../../../shared/shell-argument-quoting', () => ({
  quotePosixShell: (s: string) => `'${s}'`
}))
vi.mock('./remote-install-transfers', () => ({
  writeRemoteInstallFile: vi.fn().mockResolvedValue(undefined),
  uploadRemoteInstallDirectory: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./remote-install-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallLock>()),
  acquireInstallLock: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./occd-remote-record-file', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordFile>()),
  writeAtomicOCCdRemoteRecord: vi.fn().mockResolvedValue(undefined)
}))

const barrier = vi.hoisted(() => {
  const state: { log: string[] | null; state: 'retired' | 'unproven' | 'withdrawn' } = {
    log: null,
    state: 'retired'
  }
  return state
})
// The real stop/barrier path is covered by occd-activation-crash-recovery.test.ts.
vi.mock('../lifecycle/occd-rollback-terminal-barrier', async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalBarrier>()),
  readOCCdRollbackBarrierTarget: async (_options: unknown, version: string) => ({
    state: 'ready',
    context: {
      version,
      runtimeId: 'r1',
      instance: { pid: 1, startedAtMs: 1, nonce: 'n', lockPath: '/l' }
    }
  }),
  stopIncumbentBehindTerminalBarrier: async (
    _options: unknown,
    _id: string,
    context: { version: string }
  ) => {
    barrier.log?.push(`stop:${context.version}`)
    if (barrier.state === 'withdrawn') {
      return { state: 'withdrawn', reason: 'The stop was cancelled before occd acted on it.' }
    }
    return barrier.state === 'retired'
      ? { state: 'retired' }
      : { state: 'unproven', reason: 'A terminal started after the census.' }
  }
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { writeAtomicOCCdRemoteRecord } from './occd-remote-record-file'
import { rollbackOCCd, type OCCdRollbackOptions } from './occd-remote-rollback'
import {
  emptyOCCdActivationRecord,
  type OCCdActivationRecord
} from '../activation/occd-activation-record'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { isReadinessRead } from '../activation/occd-activation-host-test-harness'
import { isSnapshotCaptureCommand } from '../../ssh/occd-snapshot-capture-command'

const mockExec = vi.mocked(execCommand)
const ACTIVE = '0.2.0+bb01'
const TARGET = '0.1.0+aa01'
const BUILD_HASH = 'abc123def4567890'

function record(overrides: Partial<OCCdActivationRecord> = {}): OCCdActivationRecord {
  return {
    ...emptyOCCdActivationRecord(),
    active: ACTIVE,
    previous: TARGET,
    activatedAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      dirName: 'pre-0.2.0+bb01-1000',
      takenBeforeVersion: ACTIVE,
      readableByVersion: TARGET,
      takenAt: '2026-01-01T00:00:00.000Z'
    },
    ...overrides
  }
}

function readyLine(version: string): string {
  return JSON.stringify({
    type: 'occ_server_ready',
    schemaVersion: 1,
    runtimeId: 'r1',
    boundEndpoint: 'ws://127.0.0.1:7777',
    advertisedEndpoint: null,
    managedWslCliReconciliation: 'settled',
    pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
    health: {
      buildHash: BUILD_HASH,
      buildVersion: version,
      nodeVersion: '20.11.0',
      nodeAbi: '115',
      platform: 'linux',
      arch: 'x64',
      pid: 1,
      terminalDaemon: {
        state: 'live',
        ownsFreshSessions: true,
        pid: 2,
        buildVersion: version,
        entryPath: '/x/daemon-entry.js',
        protocolVersion: 3,
        selfTest: { ok: true, coverage: 'pty-spawn', verdict: 'healthy', durationMs: 5 }
      }
    }
  })
}

type HostOverrides = {
  restores?: string[]
  readinessAtMs?: number
  targetReady?: boolean
  snapshot?: string
  comparison?: string
}

function scriptHost(log: string[], overrides: HostOverrides = {}): void {
  barrier.log = log
  barrier.state = 'retired'
  const restores = [...(overrides.restores ?? [])]
  mockExec.mockImplementation(async (_conn, command: string) => {
    const text = String(command)
    if (text.startsWith('tail -c')) {
      return text.includes(TARGET) ? 'occd: listen EADDRINUSE 127.0.0.1\n' : ''
    }
    if (text.includes('__OCCD_RECORD_PRESENT__')) {
      return text.includes('transaction.json')
        ? '__OCCD_RECORD_ABSENT__\n'
        : `__OCCD_RECORD_PRESENT__\n${JSON.stringify(record())}`
    }
    if (text.includes('__OCCD_BUILD_HASH__')) {
      return `__OCCD_BUILD_HASH__ ${BUILD_HASH}\n`
    }
    if (text.includes('echo PRESENT')) {
      return overrides.snapshot ?? 'PRESENT'
    }
    if (text.includes('stat -c %Y')) {
      return 'UNKNOWN'
    }
    if (text.includes('kill -TERM')) {
      log.push(`stop:${text.includes(ACTIVE) ? ACTIVE : TARGET}`)
      return 'STOPPED'
    }
    if (text.includes('verdict=UNCHANGED')) {
      log.push('compare')
      return overrides.comparison ?? 'CHANGED'
    }
    if (isSnapshotCaptureCommand(text)) {
      log.push('rescue')
      return 'CAPTURED'
    }
    if (text.includes('tar -C') && text.includes('-xf')) {
      log.push(text.includes('rollback-rescue-') ? 'restore-rescue' : 'restore')
      return restores.shift() ?? 'RESTORED'
    }
    if (text.includes('nohup')) {
      log.push(`launch:${text.includes(ACTIVE) ? ACTIVE : TARGET}`)
      return '9999'
    }
    if (isReadinessRead(text) && text.includes('.occd-readiness')) {
      if (overrides.readinessAtMs !== undefined && Date.now() < overrides.readinessAtMs) {
        return ''
      }
      if (text.includes(ACTIVE)) {
        return readyLine(ACTIVE)
      }
      return overrides.targetReady === false ? '' : readyLine(TARGET)
    }
    return ''
  })
}

function options(overrides: Partial<OCCdRollbackOptions> = {}): OCCdRollbackOptions {
  return {
    conn: Object.create(null),
    host: getRemoteHostPlatform('linux-x64'),
    remoteHome: '/home/u',
    record: record(),
    nodePath: '/usr/bin/node',
    userDataDir: '/home/u/.occ',
    bindHost: '127.0.0.1',
    port: 7777,
    census: { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 3 },
    recountCensus: async () => ({
      liveSessions: 0,
      startedSinceActivation: 0,
      daemonProtocolVersion: 3
    }),
    releaseIncumbentAdmission: async () => {},
    targetBuildHash: BUILD_HASH,
    targetDaemonProtocol: { protocolVersion: 3, previousProtocolVersions: [1, 2] },
    readinessTimeoutMs: 50,
    sleep: async () => {},
    now: () => new Date('2026-02-02T00:00:00.000Z'),
    ...overrides
  }
}

describe('rollbackOCCd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops, restores state, then starts the target — in that order', async () => {
    const log: string[] = []
    scriptHost(log)
    const result = await rollbackOCCd(options())
    expect(result).toMatchObject({ outcome: 'rolled-back', target: TARGET })
    // Stop before replacing open state; restore before the older build can migrate it.
    expect(log).toEqual([`stop:${ACTIVE}`, 'rescue', 'restore', `launch:${TARGET}`])
  })

  it('allows rollback startup time after a slow bundled preflight', async () => {
    let elapsedMs = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsedMs)
    const log: string[] = []
    scriptHost(log, { readinessAtMs: 100_000 })
    try {
      const result = await rollbackOCCd(
        options({
          readinessTimeoutMs: undefined,
          sleep: async () => {
            elapsedMs += 50_000
          }
        })
      )
      expect(result.outcome).toBe('rolled-back')
      expect(elapsedMs).toBe(100_000)
      expect(log).toEqual([`stop:${ACTIVE}`, 'rescue', 'restore', `launch:${TARGET}`])
    } finally {
      clock.mockRestore()
    }
  })

  it('refuses before touching anything when terminals started after activation', async () => {
    const log: string[] = []
    scriptHost(log)
    const result = await rollbackOCCd(
      options({ census: { liveSessions: 3, startedSinceActivation: 2, daemonProtocolVersion: 3 } })
    )
    expect(result).toMatchObject({
      outcome: 'refused',
      code: 'occd_rollback_orphans_live_terminals'
    })
    expect(log).toEqual([])
    expect(vi.mocked(writeAtomicOCCdRemoteRecord)).not.toHaveBeenCalled()
  })

  it('counts again under the lock, closing admission, and stops nothing if a terminal opened', async () => {
    const log: string[] = []
    scriptHost(log)
    const releaseIncumbentAdmission = vi.fn(async () => {})
    const recountCensus = vi.fn(async () => ({
      liveSessions: 1,
      startedSinceActivation: 1,
      daemonProtocolVersion: 3
    }))
    const result = await rollbackOCCd(options({ recountCensus, releaseIncumbentAdmission }))
    expect(result).toMatchObject({ outcome: 'refused', code: 'occd_rollback_terminals_running' })
    expect(log).toEqual([])
    expect(vi.mocked(writeAtomicOCCdRemoteRecord)).not.toHaveBeenCalled()
    // A serving incumbent must reopen admission immediately.
    expect(releaseIncumbentAdmission).toHaveBeenCalledOnce()
  })

  it('stops nothing, reopening admission, once its recount may have outlived the fence', async () => {
    const log: string[] = []
    scriptHost(log)
    let clockMs = Date.parse('2026-02-02T00:00:00.000Z')
    vi.mocked(writeAtomicOCCdRemoteRecord).mockImplementationOnce(async () => {
      clockMs += OCCD_UPDATE_ADMISSION_STOP_BY_MS + 1
    })
    const releaseIncumbentAdmission = vi.fn(async () => {})
    const result = await rollbackOCCd(
      options({ releaseIncumbentAdmission, now: () => new Date(clockMs) })
    )
    expect(result).toMatchObject({ outcome: 'refused', code: 'occd_rollback_census_unavailable' })
    expect(log).toEqual([])
    expect(releaseIncumbentAdmission).toHaveBeenCalledOnce()
  })

  it('reopens admission when its stop was withdrawn before occd acted on it', async () => {
    scriptHost([])
    barrier.state = 'withdrawn'
    const releaseIncumbentAdmission = vi.fn(async () => {})
    await expect(rollbackOCCd(options({ releaseIncumbentAdmission }))).resolves.toMatchObject({
      code: 'occd_rollback_stop_withdrawn'
    })
    expect(releaseIncumbentAdmission).toHaveBeenCalledOnce()
  })

  it('keeps admission closed once the rollback stops the server', async () => {
    const log: string[] = []
    scriptHost(log)
    const releaseIncumbentAdmission = vi.fn(async () => {})
    await expect(rollbackOCCd(options({ releaseIncumbentAdmission }))).resolves.toMatchObject({
      outcome: 'rolled-back'
    })
    expect(releaseIncumbentAdmission).not.toHaveBeenCalled()
  })

  it('refuses when the snapshot is gone from the host', async () => {
    const log: string[] = []
    scriptHost(log, { snapshot: 'ABSENT' })
    const result = await rollbackOCCd(options())
    expect(result).toMatchObject({ outcome: 'refused', code: 'occd_rollback_snapshot_missing' })
    expect(log).toEqual([])
  })

  it('does not read a lost snapshot probe as a missing snapshot', async () => {
    const log: string[] = []
    scriptHost(log, { snapshot: '' })
    const result = await rollbackOCCd(options())
    expect(result).toMatchObject({
      outcome: 'refused',
      code: 'occd_rollback_snapshot_unverifiable'
    })
    expect(log).toEqual([])
  })

  it('puts the rescued state and the newer build back when the restore failed', async () => {
    const log: string[] = []
    scriptHost(log, { restores: ['FAILED'] })
    const result = await rollbackOCCd(options())
    expect(result).toMatchObject({ outcome: 'failed', code: 'occd_rollback_restore_failed' })
    expect(log).toEqual([
      `stop:${ACTIVE}`,
      'rescue',
      'restore',
      'restore-rescue',
      `launch:${ACTIVE}`
    ])
    expect(result.outcome === 'failed' && result.reason).toContain('is serving again')
  })

  it('keeps the newer state when a failed target may have changed it, until an operator accepts', async () => {
    const log: string[] = []
    scriptHost(log, { targetReady: false })
    const result = await rollbackOCCd(options())
    expect(result).toMatchObject({ outcome: 'failed', code: 'occd_activation_no_readiness' })
    expect(result.outcome === 'failed' && result.reason).toContain('Recover to restore')
    expect(result.outcome === 'failed' && result.reason).toContain(
      'Last lines of occd.log:\noccd: listen EADDRINUSE'
    )
    expect(log).toEqual([
      `stop:${ACTIVE}`,
      'rescue',
      'restore',
      `launch:${TARGET}`,
      `stop:${TARGET}`,
      'compare'
    ])
    // Keep active pointing at the recoverable incumbent until the target proves it is serving.
    expect(
      vi
        .mocked(writeAtomicOCCdRemoteRecord)
        .mock.calls.some((call) => String(call[1]).endsWith('occd-active.json'))
    ).toBe(false)
  })

  it('puts the newer build back unasked when a failed target left the restored state untouched', async () => {
    const log: string[] = []
    scriptHost(log, { targetReady: false, comparison: 'UNCHANGED' })
    const result = await rollbackOCCd(options())
    expect(result.outcome === 'failed' && result.reason).toContain('is serving again')
    expect(log.slice(-3)).toEqual(['compare', 'restore-rescue', `launch:${ACTIVE}`])
    const compare = mockExec.mock.calls
      .map((call) => String(call[1]))
      .find((command) => command.includes('verdict=UNCHANGED'))
    expect(compare).not.toContain('rollback-rescue-')
  })

  it('keeps the newer state and restarts the newer build when work appeared after the census', async () => {
    const log: string[] = []
    scriptHost(log)
    barrier.state = 'unproven'
    const result = await rollbackOCCd(options())
    expect(result).toMatchObject({ outcome: 'refused', code: 'occd_rollback_terminals_at_stop' })
    expect(log).toEqual([`stop:${ACTIVE}`, `launch:${ACTIVE}`])
  })

  it('records the rollback only after the target answers healthy', async () => {
    const log: string[] = []
    scriptHost(log)
    await rollbackOCCd(options())
    const written = vi
      .mocked(writeAtomicOCCdRemoteRecord)
      .mock.calls.find((call) => String(call[1]).endsWith('occd-active.json'))
    expect(JSON.parse(String(written?.[2]))).toMatchObject({
      active: TARGET,
      previous: null,
      snapshot: null
    })
  })
})
