import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagedOCCdFenceEnvironmentId } from '../../../shared/managed-occd-ssh-owner'
import { getRuntimeEnvironmentSidecarPath } from '../../../shared/runtime-environment-sidecar'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import {
  listOCCdMigrationSourceCutovers,
  writeOCCdMigrationSourceCutover
} from '../../ssh/occd-migration-cutover-journal'
import { occdMigrationCutoverFixture } from '../../ssh/occd-migration-cutover-fixture'
import {
  createManagedLifecycleHarness,
  MANAGED_VERSION
} from './occd-managed-lifecycle-test-fixture'

const mocks = vi.hoisted(() => {
  const state: { store: unknown; transaction: unknown } = { store: null, transaction: null }
  return {
    state,
    resolveContext: vi.fn(),
    census: vi.fn(),
    decommission: vi.fn(),
    recover: vi.fn(),
    cancel: vi.fn(),
    keepServing: vi.fn(),
    closeTunnel: vi.fn(),
    ensureTunnel: vi.fn(),
    retire: vi.fn()
  }
})

vi.mock('../../ssh/targets/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ connect: async () => ({}) }),
  getSshTargetRegistryStore: () => mocks.state.store
}))
vi.mock('../install/occd-remote-context', () => ({
  resolveOCCdRemoteContext: mocks.resolveContext
}))
vi.mock('../../ssh/occd-terminal-census-client', () => ({
  collectManagedTerminalCensus: mocks.census
}))
vi.mock('../install/occd-remote-decommission', () => ({
  decommissionRemoteOCCd: mocks.decommission
}))
vi.mock('../activation/occd-activation-recovery', () => ({
  recoverInterruptedOCCdActivation: mocks.recover
}))
vi.mock('../activation/occd-activation-transaction-store', () => ({
  readOCCdActivationTransaction: async () => mocks.state.transaction
}))
vi.mock('../activation/occd-activation-lock', () => ({
  withStaleOCCdActivationRecoveryLock: async (
    _options: unknown,
    run: (lock: { retain: () => void }) => Promise<unknown>
  ) => run({ retain: () => {} })
}))
vi.mock('./occd-managed-remote-stop', () => ({ cancelRemoteOCCdManagedStop: mocks.cancel }))
vi.mock('./occd-decommission-recovery', () => ({ reconcileOCCdDecommission: mocks.keepServing }))
vi.mock('./occd-managed-tunnel', () => ({
  closeOCCdManagedTunnel: mocks.closeTunnel,
  ensureOCCdManagedTunnel: mocks.ensureTunnel
}))

const { cancelManagedOCCdStop, stopManagedOCCdEnvironment } =
  await import('./occd-runtime-decommission')

const idle = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 7 }
let harness: ReturnType<typeof createManagedLifecycleHarness>

const stop = (isActive = false) =>
  stopManagedOCCdEnvironment(
    harness.userDataPath,
    { selector: 'Managed' },
    { isActiveEnvironment: () => isActive, retireLocalState: mocks.retire }
  )

function expectStillLinked(): void {
  expect(listEnvironments(harness.userDataPath)[0]?.occdDeployment).toBeDefined()
  expect(getManagedOCCdFenceEnvironmentId(harness.current())).toBe('environment-1')
  expect(mocks.retire).not.toHaveBeenCalled()
  expect(mocks.closeTunnel).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  harness = createManagedLifecycleHarness()
  mocks.state.store = harness.targetStore
  mocks.state.transaction = null
  mocks.resolveContext.mockImplementation(async () => harness.context())
  mocks.census.mockResolvedValue(idle)
})

afterEach(() => rmSync(harness.userDataPath, { recursive: true, force: true }))

describe('stopManagedOCCdEnvironment', () => {
  it('unlinks the server only after the host proves occd exited', async () => {
    writeOCCdMigrationSourceCutover(harness.userDataPath, {
      ...occdMigrationCutoverFixture('migration-1', 'ssh-1', { environmentId: 'environment-1' }),
      phase: 'destination-committed',
      sourceRetainedAt: '2026-10-01T00:00:00.000Z'
    })
    mocks.decommission.mockResolvedValueOnce({
      outcome: 'decommissioned',
      version: MANAGED_VERSION,
      retirement: 'retired'
    })
    await expect(stop()).resolves.toEqual({
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: 'environment-1',
      sshTargetId: 'ssh-1',
      stoppedVersion: MANAGED_VERSION,
      retirement: 'retired'
    })
    expect(mocks.decommission.mock.calls[0]?.[0]).toMatchObject({ census: idle, port: 6_768 })
    expect(listEnvironments(harness.userDataPath)).toEqual([])
    expect(
      readFileSync(getRuntimeEnvironmentSidecarPath(harness.userDataPath), 'utf8')
    ).not.toContain('occdDeployment')
    expect(harness.current().occdFence).toBeUndefined()
    // Persisted with the release so a reload or relaunch cannot deploy a replacement.
    expect(harness.current().managedServerRemoved).toBeDefined()
    expect(harness.flushes).toHaveLength(1)
    expect(mocks.retire).toHaveBeenCalledWith('environment-1')
    expect(mocks.closeTunnel).toHaveBeenCalledWith('environment-1')
    // Retained journals would block later conversions of this host.
    expect(listOCCdMigrationSourceCutovers(harness.userDataPath)).toEqual([])
  })

  it.each([
    ['live', 'occd_decommission_terminals_running'],
    ['unverifiable', 'occd_decommission_census_unavailable'],
    ['unverifiable', 'occd_decommission_stop_unsettled']
  ] as const)('keeps every link when the verdict is %s (%s)', async (verdict, code) => {
    mocks.decommission.mockResolvedValueOnce({ outcome: 'refused', verdict, code, reason: 'no' })
    await expect(stop()).resolves.toMatchObject({ outcome: 'refused', verdict, code })
    expectStillLinked()
    expect(existsSync(getRuntimeEnvironmentSidecarPath(harness.userDataPath))).toBe(true)
  })

  it('refuses the Active Server before contacting the host', async () => {
    await expect(stop(true)).resolves.toMatchObject({ code: 'occd_stop_active_environment' })
    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expectStillLinked()
  })

  it('finishes an interrupted stop from its journal and unlinks only on proven exit', async () => {
    mocks.state.transaction = { operation: 'decommission', activeVersion: MANAGED_VERSION }
    mocks.recover.mockResolvedValueOnce({
      outcome: 'refused',
      verdict: 'unverifiable',
      code: 'occd_recovery_decommission_unsettled',
      reason: 'no answer'
    })
    await expect(stop()).resolves.toMatchObject({ outcome: 'refused', verdict: 'unverifiable' })
    expectStillLinked()
    mocks.recover.mockResolvedValueOnce({
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion: null,
      readiness: null
    })
    await expect(stop()).resolves.toMatchObject({ outcome: 'unlinked', verdict: 'exited' })
    expect(mocks.decommission).not.toHaveBeenCalled()
  })

  it('starts over, never reading live, when another run settled the journal first', async () => {
    mocks.state.transaction = { operation: 'decommission', activeVersion: MANAGED_VERSION }
    mocks.recover.mockImplementationOnce(async () => {
      mocks.state.transaction = null
      return { outcome: 'none' }
    })
    mocks.decommission.mockResolvedValueOnce({
      outcome: 'decommissioned',
      version: MANAGED_VERSION,
      retirement: null
    })
    await expect(stop()).resolves.toMatchObject({ outcome: 'unlinked', verdict: 'exited' })

    rmSync(harness.userDataPath, { recursive: true, force: true })
    harness = createManagedLifecycleHarness()
    mocks.state.store = harness.targetStore
    mocks.state.transaction = { operation: 'decommission', activeVersion: MANAGED_VERSION }
    mocks.recover.mockResolvedValue({ outcome: 'none' })
    await expect(stop()).resolves.toMatchObject({
      outcome: 'refused',
      verdict: 'unverifiable',
      code: 'occd_stop_journal_changed'
    })
  })

  it('refuses while another interrupted operation holds the journal', async () => {
    mocks.state.transaction = { operation: 'activate' }
    await expect(stop()).resolves.toMatchObject({ code: 'occd_activation_recovery_required' })
    expectStillLinked()
  })

  it('unlinks a server whose record already shows nothing active', async () => {
    mocks.resolveContext.mockImplementation(async () => harness.context({ active: null }))
    await expect(stop()).resolves.toMatchObject({ outcome: 'unlinked', stoppedVersion: null })
    expect(mocks.decommission).not.toHaveBeenCalled()
  })
})

describe('cancelManagedOCCdStop', () => {
  const request = { transactionId: 't-1', version: MANAGED_VERSION }
  const cancel = () => cancelManagedOCCdStop(harness.userDataPath, { selector: 'Managed' })

  it('has nothing to cancel without a decommission journal', async () => {
    await expect(cancel()).resolves.toEqual({ outcome: 'none' })
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('withdraws a stop occd never acted on and keeps the server serving', async () => {
    mocks.state.transaction = {
      operation: 'decommission',
      phase: 'stop-dispatched',
      activeVersion: MANAGED_VERSION,
      request
    }
    mocks.cancel.mockResolvedValueOnce({ outcome: 'canceled' })
    mocks.keepServing.mockResolvedValueOnce({
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: MANAGED_VERSION,
      readiness: null
    })
    await expect(cancel()).resolves.toEqual({ outcome: 'canceled', activeVersion: MANAGED_VERSION })
    expect(mocks.keepServing.mock.calls[0]?.[1]).toEqual({
      action: 'keep-serving',
      version: MANAGED_VERSION
    })
    expect(mocks.ensureTunnel).toHaveBeenCalledOnce()
    expectStillLinked()
  })

  it('refuses once occd already acted on the stop', async () => {
    mocks.state.transaction = {
      operation: 'decommission',
      phase: 'stop-dispatched',
      activeVersion: MANAGED_VERSION,
      request
    }
    mocks.cancel.mockResolvedValueOnce({ outcome: 'dispatched' })
    await expect(cancel()).resolves.toMatchObject({
      outcome: 'refused',
      verdict: 'live',
      code: 'occd_stop_already_dispatched'
    })
    expect(mocks.keepServing).not.toHaveBeenCalled()
  })

  it('reports an already-exited stop for stop to finish', async () => {
    mocks.state.transaction = {
      operation: 'decommission',
      phase: 'process-exited',
      activeVersion: MANAGED_VERSION,
      request
    }
    await expect(cancel()).resolves.toEqual({ outcome: 'already-stopped' })
    expectStillLinked()
  })
})
