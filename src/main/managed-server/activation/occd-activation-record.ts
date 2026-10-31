// Keep activation identity, rollback target and state snapshot outside version directories so GC cannot erase recovery metadata.
import { remoteInstallDirName, OCCD_INSTALL_MODEL } from '../install/remote-install-model'

export const OCCD_ACTIVATION_FILENAME = 'occd-active.json'
export const OCCD_ACTIVATION_SCHEMA_VERSION = 1

export const OCCD_STATE_SNAPSHOT_DIR = 'occd-state-snapshots'

export type OCCdStateSnapshot = {
  dirName: string
  /** Activation this snapshot precedes. */
  takenBeforeVersion: string
  /** Build that produced this state and can read it during rollback. */
  readableByVersion: string | null
  takenAt: string
}

export type OCCdActivationRecord = {
  schemaVersion: typeof OCCD_ACTIVATION_SCHEMA_VERSION
  /** Content-hashed install version; null before activation or after decommission. */
  active: string | null
  /** Rollback target, pinned against GC. */
  previous: string | null
  activatedAt: string | null
  snapshot: OCCdStateSnapshot | null
  /** Optional app provenance; older builds omit it, so mixed-version readers must tolerate absence. */
  activeAppVersion?: string
  previousAppVersion?: string
  /** Explicit rollback suppresses reconnect auto-reactivation of this build. */
  rolledBackFrom?: string
}

export function emptyOCCdActivationRecord(): OCCdActivationRecord {
  return {
    schemaVersion: OCCD_ACTIVATION_SCHEMA_VERSION,
    active: null,
    previous: null,
    activatedAt: null,
    snapshot: null
  }
}

/** Distinguish absent from unreadable so older clients cannot deploy over records they cannot interpret. */
export type OCCdActivationReadResult =
  | { state: 'absent' }
  | { state: 'ok'; record: OCCdActivationRecord }
  | { state: 'unreadable'; reason: string }

export function parseOCCdActivationRecord(raw: string | null): OCCdActivationReadResult {
  if (raw === null || raw.trim() === '') {
    return { state: 'absent' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      state: 'unreadable',
      reason: `activation record is not JSON: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { state: 'unreadable', reason: 'activation record is not an object' }
  }
  const record = parsed as Partial<OCCdActivationRecord>
  if (record.schemaVersion !== OCCD_ACTIVATION_SCHEMA_VERSION) {
    return {
      state: 'unreadable',
      reason:
        `activation record schemaVersion ${String(record.schemaVersion)} is not ` +
        `${OCCD_ACTIVATION_SCHEMA_VERSION}; this client cannot safely interpret it`
    }
  }
  return {
    state: 'ok',
    record: {
      schemaVersion: OCCD_ACTIVATION_SCHEMA_VERSION,
      active: typeof record.active === 'string' ? record.active : null,
      previous: typeof record.previous === 'string' ? record.previous : null,
      activatedAt: typeof record.activatedAt === 'string' ? record.activatedAt : null,
      snapshot: parseSnapshot(record.snapshot),
      ...(typeof record.activeAppVersion === 'string'
        ? { activeAppVersion: record.activeAppVersion }
        : {}),
      ...(typeof record.previousAppVersion === 'string'
        ? { previousAppVersion: record.previousAppVersion }
        : {}),
      ...(typeof record.rolledBackFrom === 'string'
        ? { rolledBackFrom: record.rolledBackFrom }
        : {})
    }
  }
}

function parseSnapshot(value: unknown): OCCdStateSnapshot | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const snapshot = value as Partial<OCCdStateSnapshot>
  if (typeof snapshot.dirName !== 'string' || typeof snapshot.takenBeforeVersion !== 'string') {
    return null
  }
  return {
    dirName: snapshot.dirName,
    takenBeforeVersion: snapshot.takenBeforeVersion,
    readableByVersion:
      typeof snapshot.readableByVersion === 'string' ? snapshot.readableByVersion : null,
    takenAt: typeof snapshot.takenAt === 'string' ? snapshot.takenAt : ''
  }
}

/** Omit advisory fields dropped by older peers so their journals still match the committed core record. */
export function coreOCCdActivationRecord(record: OCCdActivationRecord): OCCdActivationRecord {
  const {
    activeAppVersion: _app,
    previousAppVersion: _prev,
    rolledBackFrom: _held,
    ...core
  } = record
  return core
}

export function serializeOCCdActivationRecord(record: OCCdActivationRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

export function withActivatedVersion(
  record: OCCdActivationRecord,
  version: string,
  snapshot: OCCdStateSnapshot | null,
  now: Date,
  appVersion?: string
): OCCdActivationRecord {
  const same = record.active === version
  // A decommissioned record can retain app provenance without naming an active predecessor.
  const previousAppVersion = same
    ? record.previousAppVersion
    : record.active
      ? record.activeAppVersion
      : undefined
  return {
    schemaVersion: OCCD_ACTIVATION_SCHEMA_VERSION,
    active: version,
    // Re-activating identical bytes must preserve the existing rollback target.
    previous: same ? record.previous : record.active,
    activatedAt: now.toISOString(),
    snapshot: same ? record.snapshot : snapshot,
    ...(appVersion ? { activeAppVersion: appVersion } : {}),
    ...(previousAppVersion ? { previousAppVersion } : {})
  }
}

export function withRolledBackVersion(
  record: OCCdActivationRecord,
  now: Date
): OCCdActivationRecord {
  return {
    schemaVersion: OCCD_ACTIVATION_SCHEMA_VERSION,
    active: record.previous,
    // Rolling back must not offer the failed build as the next rollback target.
    previous: null,
    activatedAt: now.toISOString(),
    // Restoring consumes the snapshot taken before the outgoing build ran.
    snapshot: null,
    ...(record.previousAppVersion ? { activeAppVersion: record.previousAppVersion } : {}),
    ...(record.active ? { rolledBackFrom: record.active } : {})
  }
}

export function withDeactivatedVersion(record: OCCdActivationRecord): OCCdActivationRecord {
  return {
    schemaVersion: OCCD_ACTIVATION_SCHEMA_VERSION,
    active: null,
    // Pin the stopped build for redeploy and any daemon still using its entry.
    previous: record.active,
    activatedAt: null,
    snapshot: null
  }
}

/** Commit-only provenance; never journal it because released peers compare core-only stop records byte for byte. */
export function withDeactivatedVersionCommitted(
  record: OCCdActivationRecord
): OCCdActivationRecord {
  return {
    ...withDeactivatedVersion(record),
    // Newer state may survive decommission; preserve provenance so older planners still refuse it.
    ...(record.activeAppVersion ? { activeAppVersion: record.activeAppVersion } : {}),
    ...(record.rolledBackFrom ? { rolledBackFrom: record.rolledBackFrom } : {})
  }
}

/** Pin rollback bytes and any outgoing bundle still serving a live daemon. */
export function occdGcPinnedDirNames(
  record: OCCdActivationRecord,
  daemonEntryVersion?: string | null
): string[] {
  return occdInstallDirNames([record.active, record.previous, daemonEntryVersion])
}

export function occdInstallDirNames(versions: readonly (string | null | undefined)[]): string[] {
  const named = versions.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return [...new Set(named)].map((version) => remoteInstallDirName(OCCD_INSTALL_MODEL, version))
}
