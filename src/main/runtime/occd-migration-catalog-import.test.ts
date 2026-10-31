import { describe, expect, it, vi } from 'vitest'
import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogReferenceAbortResult,
  OCCdMigrationCatalogState
} from '../../shared/occd-migration/occd-migration-manifest'
import { occdMigrationCutoverFixture } from '../ssh/occd-migration-cutover-fixture'
import {
  abortStagedOCCdMigrationCatalogByReferenceDurably,
  abortStagedOCCdMigrationCatalogDurably,
  commitStagedOCCdMigrationCatalogDurably,
  stageOCCdMigrationCatalogDurably
} from './occd-migration-catalog-import'

const { manifest } = occdMigrationCutoverFixture()
const reference = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }

describe('durable occd migration catalog import', () => {
  it('does not acknowledge staging until its dormant manifest is durable', async () => {
    const diskError = new Error('disk full')
    const staged: OCCdMigrationCatalogState = {
      state: 'staged',
      ...reference,
      stagedAt: '2026-10-01T00:00:01.000Z'
    }
    const stage = vi.fn().mockReturnValue(staged)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const args = {
      store: {
        stageOCCdMigrationCatalog: stage,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(stageOCCdMigrationCatalogDurably(args)).rejects.toBe(diskError)
    await expect(stageOCCdMigrationCatalogDurably(args)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('publishes a committed catalog only after its receipt is durable', async () => {
    const diskError = new Error('disk full')
    const committed: OCCdMigrationCatalogState = {
      state: 'committed',
      ...reference,
      receipt: {
        version: manifest.version,
        ...reference,
        source: manifest.source,
        importedAt: '2026-10-01T00:00:02.000Z',
        repositoryIds: [],
        projectGroupIds: [],
        folderWorkspaceIds: []
      }
    }
    const commit = vi.fn().mockReturnValue(committed)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const onDurableCommit = vi.fn()
    const args = {
      store: {
        commitStagedOCCdMigrationCatalog: commit,
        flushPendingOrThrowAsync: flush
      },
      manifest,
      onDurableCommit
    }

    await expect(commitStagedOCCdMigrationCatalogDurably(args)).rejects.toBe(diskError)
    expect(onDurableCommit).not.toHaveBeenCalled()
    await expect(commitStagedOCCdMigrationCatalogDurably(args)).resolves.toBe(committed)
    expect(onDurableCommit).toHaveBeenCalledOnce()
  })

  it('reflushes an already-absent abort after the first flush failed', async () => {
    const aborted: OCCdMigrationCatalogAbortResult = {
      state: 'absent',
      ...reference,
      aborted: true
    }
    const unchanged: OCCdMigrationCatalogAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedOCCdMigrationCatalog: abort,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(abortStagedOCCdMigrationCatalogDurably(args)).rejects.toThrow('disk full')
    await expect(abortStagedOCCdMigrationCatalogDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('answers an abort by reference absent only once its flush succeeds', async () => {
    const aborted: OCCdMigrationCatalogReferenceAbortResult = {
      ...reference,
      state: 'absent',
      aborted: true
    }
    const unchanged: OCCdMigrationCatalogReferenceAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedOCCdMigrationCatalogByReference: abort,
        flushPendingOrThrowAsync: flush
      },
      reference
    }

    await expect(abortStagedOCCdMigrationCatalogByReferenceDurably(args)).rejects.toThrow(
      'disk full'
    )
    await expect(abortStagedOCCdMigrationCatalogByReferenceDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('flushes before answering committed by reference, and says so', async () => {
    const reference = { migrationId: 'move-1', manifestSha256: 'a'.repeat(64) }
    const committed = { ...reference, state: 'committed' as const, aborted: false }
    const flush = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    const args = {
      store: {
        abortStagedOCCdMigrationCatalogByReference: vi.fn().mockReturnValue(committed),
        flushPendingOrThrowAsync: flush
      },
      reference
    }

    // A committed answer whose flush failed must not reach a caller that would act on it.
    await expect(abortStagedOCCdMigrationCatalogByReferenceDurably(args)).rejects.toThrow(
      'disk full'
    )
    await expect(abortStagedOCCdMigrationCatalogByReferenceDurably(args)).resolves.toEqual({
      ...committed,
      durableCommitted: true
    })
  })
})
