import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { listOCCdMigrationSourceCutovers } from './occd-migration-cutover-journal'

/** Use the durable migration mark or older delta journal time; unreadable journals conservatively return now to block destructive rollback. */
export function latestOCCdMigrationInto(
  userDataPath: string,
  environment: KnownRuntimeEnvironment
): string | undefined {
  let started: string[]
  try {
    started = listOCCdMigrationSourceCutovers(userDataPath)
      .filter((cutover) => cutover.destinationEnvironmentId === environment.id)
      .map((cutover) => cutover.startedAt)
  } catch {
    return new Date().toISOString()
  }
  return [environment.occdMigratedAt, ...started]
    .filter((at): at is string => at !== undefined)
    .reduce<string | undefined>(
      (latest, at) => (latest === undefined || Date.parse(at) > Date.parse(latest) ? at : latest),
      undefined
    )
}
