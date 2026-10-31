import { chmodSync, statSync } from 'node:fs'
import process from 'node:process'
import { restrictWindowsPathSync } from '../../shared/secure-path-windows-acl'

type OCCdInstanceLockCode =
  | 'occd_data_root_unusable'
  | 'occd_data_root_wrong_owner'
  | 'occd_data_root_shared'
  | 'occd_instance_lock_held'
  /** Shared-home/foreign-machine owners may still run and cannot be judged here. */
  | 'occd_instance_lock_holder_unverifiable'
  | 'occd_instance_lock_foreign_identity'
  | 'occd_instance_lock_unreadable'

export class OCCdInstanceLockError extends Error {
  constructor(
    readonly code: OCCdInstanceLockCode,
    message: string
  ) {
    super(message)
    this.name = 'OCCdInstanceLockError'
  }
}

export type OCCdDataRootPrivacyHooks = {
  platform?: NodeJS.Platform
  restrictWindowsDataRoot?: (dataRoot: string) => boolean
}

/** Repair owned directory permissions before refusing: roots contain credentials and session state. */
export function assertOCCdDataRootIsPrivate(
  dataRoot: string,
  hooks: OCCdDataRootPrivacyHooks
): void {
  // Windows synthesizes POSIX mode bits; restrict and verify real ACLs instead.
  if ((hooks.platform ?? process.platform) === 'win32') {
    const restrict =
      hooks.restrictWindowsDataRoot ?? ((path: string) => restrictWindowsPathSync(path, true))
    if (!restrict(dataRoot)) {
      throw new OCCdInstanceLockError(
        'occd_data_root_shared',
        `Could not restrict the occd data root ${dataRoot} to this user. occd keeps ` +
          'private session and credential state there, so it refuses to start. Point OCC_USER_DATA at a ' +
          'directory this account owns.'
      )
    }
    return
  }
  let stats
  try {
    stats = statSync(dataRoot)
  } catch (error) {
    throw new OCCdInstanceLockError(
      'occd_data_root_unusable',
      `Cannot stat the occd data root ${dataRoot}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const uid = process.getuid?.()
  if (uid !== undefined && stats.uid !== uid) {
    throw new OCCdInstanceLockError(
      'occd_data_root_wrong_owner',
      `The occd data root ${dataRoot} is owned by uid ${stats.uid}, not by uid ${uid} running ` +
        'this process. Give occd its own data root (OCC_USER_DATA) or chown this one.'
    )
  }
  if ((stats.mode & 0o077) === 0) {
    return
  }
  try {
    chmodSync(dataRoot, 0o700)
  } catch {
    // Re-stat to produce the actionable permission error.
  }
  let mode: number
  try {
    mode = statSync(dataRoot).mode
  } catch (error) {
    throw new OCCdInstanceLockError(
      'occd_data_root_unusable',
      `Cannot stat the occd data root ${dataRoot}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if ((mode & 0o077) !== 0) {
    throw new OCCdInstanceLockError(
      'occd_data_root_shared',
      `The occd data root ${dataRoot} is accessible to other users (mode ` +
        `${(mode & 0o777).toString(8)}) and could not be tightened. occd keeps ` +
        'private session and credential state there, so it refuses to start. Run `chmod 700` on it, or point OCC_USER_DATA ' +
        'at a private directory.'
    )
  }
}
