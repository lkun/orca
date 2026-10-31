/** Persist journals in owner-only profile sidecars: older profile schemas drop unknown fields but retain fences, so an in-profile journal could vanish on downgrade. Unreadable journals fail closed. */
import {
  MAX_OCCD_MIGRATION_SOURCE_CUTOVERS,
  isRetainedOCCdMigrationSourceCutover,
  parseOCCdMigrationSourceCutover,
  type OCCdMigrationSourceCutover
} from '../../shared/occd-migration/occd-migration-source-cutover'
import {
  createMigrationJournalDirectory,
  orderMigrationJournalChain
} from '../persistence/migrating-occd-catalog/migration-journal-directory'

class OCCdMigrationCutoverJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The migration journal cannot be read, so the SSH host stays fenced: ${detail}`)
    this.name = 'OCCdMigrationCutoverJournalUnreadableError'
  }
}

type JournalChangeListener = (userDataPath: string) => void
let journalChangeListener: JournalChangeListener | null = null

export function setOCCdMigrationJournalChangeListener(
  listener: JournalChangeListener | null
): void {
  journalChangeListener = listener
}

const journals = createMigrationJournalDirectory({
  directoryName: 'occd-migration-cutovers',
  // A manifest carries catalog rows and dormant session state, never scrollback bytes.
  maxFileBytes: 16 * 1024 * 1024,
  parse: parseOCCdMigrationSourceCutover,
  unreadable: (detail) => new OCCdMigrationCutoverJournalUnreadableError(detail),
  onChange: (userDataPath) => journalChangeListener?.(userDataPath)
})

export function occdMigrationCutoverJournalDirectory(userDataPath: string): string {
  return journals.directory(userDataPath)
}

/** Never skip an unreadable or untrusted journal. */
export function listOCCdMigrationSourceCutovers(
  userDataPath: string
): OCCdMigrationSourceCutover[] {
  return journals.list(userDataPath)
}

export function findOCCdMigrationSourceCutoverForTarget(
  userDataPath: string,
  sshTargetId: string
): OCCdMigrationSourceCutover | null {
  const chain = listOCCdMigrationCutoverChainForTarget(userDataPath, sshTargetId)
  return chain.at(-1) ?? null
}

/** Oldest first; throws unless the target's journals form one chain of delta moves. */
export function listOCCdMigrationCutoverChainForTarget(
  userDataPath: string,
  sshTargetId: string
): OCCdMigrationSourceCutover[] {
  const matches = listOCCdMigrationSourceCutovers(userDataPath).filter(
    (cutover) => cutover.sshTargetId === sshTargetId
  )
  return orderMigrationJournalChain(
    matches,
    (detail) => new OCCdMigrationCutoverJournalUnreadableError(detail),
    `SSH target ${sshTargetId}`
  )
}

/** Flush before returning so later fence writes always have a durable journal. */
export function writeOCCdMigrationSourceCutover(
  userDataPath: string,
  cutover: OCCdMigrationSourceCutover
): void {
  const parsed = parseOCCdMigrationSourceCutover(cutover)
  const existing = listOCCdMigrationSourceCutovers(userDataPath)
  // Finished retained cutovers can wait two releases; only in-flight journals count toward the bound.
  const inFlight = existing.filter(
    (entry) => entry.phase !== 'source-retired' && !isRetainedOCCdMigrationSourceCutover(entry)
  )
  if (
    !existing.some((entry) => entry.migrationId === parsed.migrationId) &&
    inFlight.length >= MAX_OCCD_MIGRATION_SOURCE_CUTOVERS
  ) {
    throw new Error('occd_migration_cutover_capacity_exceeded')
  }
  journals.write(userDataPath, parsed)
}

export function removeOCCdMigrationSourceCutover(userDataPath: string, migrationId: string): void {
  journals.remove(userDataPath, migrationId)
}

export function removeOCCdMigrationJournalsForDestination(
  userDataPath: string,
  sshTargetId: string,
  environmentId: string
): void {
  for (const cutover of listOCCdMigrationSourceCutovers(userDataPath)) {
    if (cutover.sshTargetId === sshTargetId && cutover.destinationEnvironmentId === environmentId) {
      removeOCCdMigrationSourceCutover(userDataPath, cutover.migrationId)
    }
  }
}
