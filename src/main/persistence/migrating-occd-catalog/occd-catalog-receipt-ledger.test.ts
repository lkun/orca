import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { MAX_OCCD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/occd-migration/occd-migration-manifest-validation'
import { manifest } from './persistence-occd-migration-catalog-fixture'
import {
  expireOCCdMigrationStages,
  findOCCdMigrationImportReceipt,
  OCCD_MIGRATION_STAGE_TTL_MS,
  recordOCCdMigrationImportReceipt
} from './occd-catalog-receipt-ledger'

const empty = { repositories: [], projectGroups: [], folderWorkspaces: [] }

function receiptFor(migrationId: string) {
  const input = manifest({ migrationId, payload: empty })
  return {
    input,
    receipt: {
      version: input.version,
      migrationId,
      manifestSha256: input.manifestSha256,
      source: input.source,
      importedAt: '2026-10-01T00:00:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
  }
}

describe('occd migration receipt ledger', () => {
  it('keeps answering for a commit whose receipt aged out of the bounded list', () => {
    const state = getDefaultPersistedState('/tmp/occd-receipt-ledger')
    const first = receiptFor('migration-0')
    recordOCCdMigrationImportReceipt(state, first.receipt)
    for (let index = 1; index <= MAX_OCCD_MIGRATION_IMPORT_RECEIPTS; index++) {
      recordOCCdMigrationImportReceipt(state, receiptFor(`migration-${index}`).receipt)
    }
    expect(state.occdMigrationImportReceipts).toHaveLength(MAX_OCCD_MIGRATION_IMPORT_RECEIPTS)
    expect(findOCCdMigrationImportReceipt(state, first.input)).toEqual(first.receipt)
    expect(findOCCdMigrationImportReceipt(state, receiptFor('never').input)).toBeUndefined()
  })

  it('expires a stage no client came back for', () => {
    const state = getDefaultPersistedState('/tmp/occd-receipt-ledger')
    const stagedAt = '2026-10-01T00:00:00.000Z'
    state.occdMigrationStagedCatalogs = [{ version: 1, manifest: manifest(), stagedAt }]
    const start = Date.parse(stagedAt)
    expect(expireOCCdMigrationStages(state, start + OCCD_MIGRATION_STAGE_TTL_MS - 1)).toBe(false)
    expect(expireOCCdMigrationStages(state, start + OCCD_MIGRATION_STAGE_TTL_MS)).toBe(true)
    expect(state.occdMigrationStagedCatalogs).toEqual([])
  })
})
