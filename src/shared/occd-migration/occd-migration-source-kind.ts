/** Legacy SSH omits source.kind to preserve signed bytes/digests. Other kinds must set kind and omit sshTargetId:
 * older destinations strip unknown fields, then fail parsing instead of importing a non-SSH source as SSH. */
import type {
  OCCdMigrationLocalWslManifestSource,
  OCCdMigrationManifestSource,
  OCCdMigrationSshManifestSource
} from './occd-migration-manifest'
import { OCCD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from '../occd-runtime-capabilities'

export const OCCD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const OCCD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': OCCD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type OCCdMigrationNonSshSourceKind = keyof typeof OCCD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type OCCdMigrationSourceKind =
  | typeof OCCD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | OCCdMigrationNonSshSourceKind

export const OCCD_MIGRATION_SOURCE_KIND_UNKNOWN = 'occd_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type OCCdMigrationWireSource = Readonly<Record<string, unknown>>

export function occdMigrationManifestSourceKind(
  source: OCCdMigrationWireSource
): OCCdMigrationSourceKind {
  if (source.kind === undefined) {
    return OCCD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(OCCD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is OCCdMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(OCCD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredOCCdMigrationSourceCapability(
  source: OCCdMigrationWireSource
): string | null {
  const kind = occdMigrationManifestSourceKind(source)
  return kind === OCCD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : OCCD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}

export function isOCCdMigrationLocalWslSource(
  source: OCCdMigrationManifestSource
): source is OCCdMigrationLocalWslManifestSource {
  return 'kind' in source && source.kind === 'local-wsl'
}

/** For the SSH conversion's own steps: a WSL manifest reaching them is a bug, never a fallback. */
export function requireOCCdMigrationSshSource(
  source: OCCdMigrationManifestSource
): OCCdMigrationSshManifestSource {
  if (isOCCdMigrationLocalWslSource(source)) {
    throw new Error('occd_migration_source_not_ssh')
  }
  return source
}
