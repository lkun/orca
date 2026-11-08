import { describe, expect, it, vi } from 'vitest'
import {
  emptyOCCdActivationRecord,
  type OCCdActivationRecord
} from '../activation/occd-activation-record'

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

import { planManagedOCCdAutoUpdate } from './occd-managed-update-decision'
import { autoUpdateManagedOCCdEnvironment } from './occd-managed-auto-update'
import { OCCdCrashLoopError } from './occd-managed-crash-loop'

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

describe('an auto-update that finds the host braked for crashing', () => {
  // Recording it as failed would block update retries for the rest of the session.
  it('is not an update failure: the host already runs this build', async () => {
    mocks.state.record = record({})
    mocks.runUpdate.mockRejectedValueOnce(
      new OCCdCrashLoopError('OCC stopped restarting its server on Box')
    )

    expect(
      await autoUpdateManagedOCCdEnvironment('/user-data', {
        environmentId: 'env-1',
        appVersion: '1.5.0',
        failedBefore: () => false,
        onUpdating: () => {}
      })
    ).toEqual({ outcome: 'skipped', reason: 'current' })
  })
})
