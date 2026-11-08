import {
  occdMigrationAutomationRunHistoryBlob,
  withOCCdMigrationAutomationRunHistory
} from '../../../shared/occd-migration/occd-migration-automation-run-history'
import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import { readOCCdMigrationBlob } from './occd-migration-blob-staging'

/** The manifest signs the history's digest, so its rows import with the catalog or not at all. */
export function withStagedAutomationRunHistory(
  manifest: OCCdMigrationManifest,
  blobRoot: string
): OCCdMigrationManifest {
  const ref = manifest.payload.dormantState?.automationRunHistory
  if (!ref) {
    return manifest
  }
  const descriptor = occdMigrationAutomationRunHistoryBlob(ref)
  return withOCCdMigrationAutomationRunHistory(
    manifest,
    readOCCdMigrationBlob(manifest, blobRoot, descriptor).toString('utf8')
  )
}
