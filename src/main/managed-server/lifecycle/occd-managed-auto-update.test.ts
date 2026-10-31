import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyOCCdActivationRecord,
  type OCCdActivationRecord
} from '../activation/occd-activation-record'
import { OCCdHostUnsupportedError } from '../../occd/occd-host-unavailable'

const mocks = vi.hoisted(() => {
  const state: { record: OCCdActivationRecord | null } = { record: null }
  return {
    state,
    materialize: vi.fn(async (_target: string) => '/cache/occd'),
    runUpdate: vi.fn(),
    migrating: vi.fn((_userData: string, _environmentId: string): unknown => null)
  }
})

vi.mock('../../ssh/occd-runtime-maintenance', () => ({
  withManagedOCCdLifecycle: (
    _userData: string,
    _selector: string,
    run: (managed: unknown) => Promise<unknown>
  ) => run({ environment: { id: 'env-1' }, deployment: {} }),
  runManagedOCCdUpdate: mocks.runUpdate
}))
vi.mock('./occd-managed-runtime-context', () => ({
  resolveLinkedOCCdContext: async () => ({
    activationRecord: mocks.state.record,
    serverTarget: 'linux-x64'
  })
}))
vi.mock('./occd-managed-migration-status', () => ({
  findIncompleteManagedOCCdMigration: mocks.migrating
}))
vi.mock('../../occd/occd-artifact-materializer', () => ({
  materializeOCCdArtifact: mocks.materialize
}))
vi.mock('../install/remote-versioned-install', () => ({
  readLocalFullVersion: () => '0.1.0+new'
}))

import {
  autoUpdateManagedOCCdEnvironment,
  resetBundledOCCdVersionsForTests
} from './occd-managed-auto-update'
import { planManagedOCCdAutoUpdate } from './occd-managed-update-decision'

function record(overrides: Partial<OCCdActivationRecord>): OCCdActivationRecord {
  return { ...emptyOCCdActivationRecord(), active: '0.1.0+old', ...overrides }
}

const plan = (r: OCCdActivationRecord, extra: { failedBefore?: boolean } = {}) =>
  planManagedOCCdAutoUpdate({
    record: r,
    candidateVersion: '0.1.0+new',
    appVersion: '1.5.0',
    failedBefore: extra.failedBefore ?? false
  })

describe('whether a connect updates its managed occd', () => {
  it('skips a host already on this build', () => {
    expect(plan(record({ active: '0.1.0+new' }))).toEqual({ action: 'skip', reason: 'current' })
  })

  it('updates a host an older or pre-tracking OCC activated', () => {
    expect(plan(record({ activeAppVersion: '1.4.0' }))).toEqual({ action: 'update' })
    expect(plan(record({}))).toEqual({ action: 'update' })
  })

  it('never downgrades a host a newer OCC activated', () => {
    expect(plan(record({ activeAppVersion: '1.6.0' }))).toEqual({
      action: 'skip',
      reason: 'host-newer'
    })
  })

  it('leaves alone a build an explicit rollback moved away from', () => {
    expect(plan(record({ rolledBackFrom: '0.1.0+new' }))).toEqual({
      action: 'skip',
      reason: 'rolled-back'
    })
  })

  it('does not retry an update that already failed for this app version', () => {
    expect(plan(record({}), { failedBefore: true })).toEqual({
      action: 'skip',
      reason: 'failed-before'
    })
  })

  it('skips when the template carries no build for the host', () => {
    expect(
      planManagedOCCdAutoUpdate({
        record: record({}),
        candidateVersion: null,
        appVersion: '1.5.0',
        failedBefore: false
      })
    ).toEqual({ action: 'skip', reason: 'no-template' })
  })
})

describe('updating a managed occd on connect', () => {
  const run = () =>
    autoUpdateManagedOCCdEnvironment('/user-data', {
      environmentId: 'env-1',
      appVersion: '1.5.0',
      failedBefore: () => false,
      onUpdating: vi.fn()
    })

  beforeEach(() => {
    resetBundledOCCdVersionsForTests()
    mocks.materialize.mockReset().mockResolvedValue('/cache/occd')
    mocks.runUpdate.mockReset()
    mocks.migrating.mockReset().mockReturnValue(null)
    mocks.state.record = record({ activeAppVersion: '1.4.0' })
  })

  it('runs the Managed servers update, never forced past running terminals', async () => {
    mocks.runUpdate.mockResolvedValue({ outcome: 'updated', activeVersion: '0.1.0+new' })
    await expect(run()).resolves.toEqual({ outcome: 'updated', activeVersion: '0.1.0+new' })
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      '/user-data',
      expect.anything(),
      expect.anything(),
      { admitRecord: expect.any(Function) }
    )
  })

  it.each([
    ['active', record({ active: '0.1.1+newer', activeAppVersion: '1.6.0' })],
    ['stopped', record({ active: null, previous: '0.1.1+newer', activeAppVersion: '1.6.0' })]
  ])(
    'skips when the record under the fence names a newer %s build than the one planned on',
    async (_name, lockedRecord) => {
      let admitted: string | null = 'not called'
      mocks.runUpdate.mockImplementation(async (_u, _m, _c, args) => {
        admitted = args.admitRecord(lockedRecord)
        return { outcome: 'deferred', code: 'occd_activation_policy_refused', reason: 'x' }
      })
      await expect(run()).resolves.toEqual({ outcome: 'skipped', reason: 'host-newer' })
      expect(admitted).toEqual(expect.any(String))
    }
  )

  it('admits the record under the fence when it still allows this build', async () => {
    let admitted: string | null = 'not called'
    mocks.runUpdate.mockImplementation(async (_u, _m, _c, args) => {
      admitted = args.admitRecord(record({ activeAppVersion: '1.4.0' }))
      return { outcome: 'updated', activeVersion: '0.1.0+new' }
    })
    await expect(run()).resolves.toMatchObject({ outcome: 'updated' })
    expect(admitted).toBeNull()
  })

  it('reports live terminals as a wait, and a rejected candidate as a failure', async () => {
    mocks.runUpdate.mockResolvedValueOnce({
      outcome: 'deferred',
      code: 'occd_update_terminals_running',
      reason: '1 terminal is running on this host.'
    })
    await expect(run()).resolves.toMatchObject({ outcome: 'deferred' })

    mocks.runUpdate.mockResolvedValueOnce({
      outcome: 'deferred',
      code: 'occd_activation_fence_busy',
      reason: 'Another run is changing this host.'
    })
    await expect(run()).resolves.toMatchObject({ outcome: 'deferred' })

    mocks.runUpdate.mockResolvedValueOnce({
      outcome: 'deferred',
      code: 'occd_candidate_launch_failed',
      reason: 'The candidate failed while starting. occd 0.1.0+old was restarted.'
    })
    await expect(run()).resolves.toEqual({
      outcome: 'failed',
      reason: 'The candidate failed while starting. occd 0.1.0+old was restarted.'
    })

    mocks.runUpdate.mockRejectedValueOnce(new Error('Could not snapshot state'))
    await expect(run()).resolves.toEqual({ outcome: 'failed', reason: 'Could not snapshot state' })
  })

  it('reads the bundled build once per session', async () => {
    mocks.state.record = record({ active: '0.1.0+new' })
    await run()
    await run()
    expect(mocks.materialize).toHaveBeenCalledTimes(1)
    expect(mocks.runUpdate).not.toHaveBeenCalled()
  })

  it('leaves a server alone while a migration into it is still running', async () => {
    mocks.migrating.mockReturnValue({ migrationId: 'm', phase: 'staged' })
    await expect(run()).resolves.toEqual({ outcome: 'skipped', reason: 'migrating' })
    expect(mocks.runUpdate).not.toHaveBeenCalled()
  })

  it('skips a host whose target the template does not carry', async () => {
    mocks.materialize.mockRejectedValue(new OCCdHostUnsupportedError('no linux-x64'))
    await expect(run()).resolves.toEqual({ outcome: 'skipped', reason: 'no-template' })
  })
})
