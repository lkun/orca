/** Registered destinations must abort/prove empty, then unregister before fence release so later starts cannot reclaim the host. Never-registered destinations held nothing. */
import { removeManagedOCCdEnvironment } from '../../shared/remote-runtime/host-store/runtime-environment-managed-occd-store'
import { listEnvironments } from '../../shared/remote-runtime/host-store/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import { closeOCCdManagedTunnel } from '../managed-server/lifecycle/occd-managed-tunnel'
import {
  abortOCCdMigrationCutover,
  type OCCdMigrationAbortResult,
  type OCCdMigrationCutoverContext,
  type OCCdMigrationDestinationCatalog
} from './occd-migration-cutover-coordinator'
import { findOCCdMigrationSourceCutoverForTarget } from './occd-migration-cutover-journal'
import {
  releaseOCCdMigrationFence,
  releaseUndeployedMigrationFence
} from './occd-migration-source-fence'

export async function abandonOCCdConversion(args: {
  userDataPath: string
  store: OCCdMigrationCutoverContext['store']
  claims: OCCdMigrationCutoverContext['claims']
  targetId: string
  destinationFor: (environment: KnownRuntimeEnvironment) => OCCdMigrationDestinationCatalog
}): Promise<OCCdMigrationAbortResult | 'none'> {
  const cutover = findOCCdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Committed delta chains resolve only through the delta flow.
  if (!cutover || cutover.supersedesMigrationId) {
    return 'none'
  }
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  const environment = listEnvironments(args.userDataPath).find(
    (entry) => entry.id === cutover.destinationEnvironmentId
  )
  if (!environment) {
    await releaseUndeployedMigrationFence({ ...args, isDestinationRegistered: isRegistered })
    return 'none'
  }
  const context = { ...args, destination: args.destinationFor(environment) }
  return abortOCCdMigrationCutover(context, cutover.migrationId, async (aborted) => {
    await closeOCCdManagedTunnel(environment.id).catch(() => undefined)
    removeManagedOCCdEnvironment(args.userDataPath, environment.id)
    await releaseOCCdMigrationFence(context, aborted)
  })
}
