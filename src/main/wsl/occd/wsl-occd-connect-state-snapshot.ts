/**
 * One read of the activation state a WSL connect checks before its fence: the activation record,
 * the transaction journal, the activation fence and occd's instance lock. Each consumer takes it
 * only as a hint that lets it skip a read whose answer would let it continue unchanged; anything
 * else, and every fenced decision, still reads the host.
 */
import {
  emptyOCCdActivationRecord,
  parseOCCdActivationRecord,
  type OCCdActivationReadResult,
  type OCCdActivationRecord
} from '../../managed-server/activation/occd-activation-record'
import {
  occdActivationPath,
  readOCCdActivationRecord
} from '../../managed-server/activation/occd-activation-record-store'
import {
  occdActivationFenceLockDir,
  occdActivationTransactionPath,
  parseOCCdActivationTransaction
} from '../../managed-server/activation/occd-activation-transaction'
import { execOCCdRemote } from '../../managed-server/install/occd-remote-runtime-control'
import { probeInstallLockExistsCommand } from '../../managed-server/install/remote-install-lock-commands'
import { OCCD_LOCK_FILE_NAME } from '../../occd/occd-instance-lock'
import {
  parseWslGuestIdentity,
  wslGuestIdentityShellCommand,
  type WslGuestIdentity
} from '../execution/wsl-guest-process-identity'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'

// The record stores' own caps; a larger file reads as unreadable, as theirs does.
const RECORD_MAX_BYTES = 64 * 1024
const SECTION_END = '__OCC_WSL_CONNECT_STATE_END__'

/** The guest's identity read for the pid the lock named, so liveness needs no second exec. */
export type WslOCCdLockHolderIdentity = { pid: number; guest: WslGuestIdentity }

export type WslOCCdInstanceLockRead =
  | { state: 'absent' }
  | { state: 'present'; raw: string; holder?: WslOCCdLockHolderIdentity }

export type WslOCCdConnectStateSnapshot = {
  activation: OCCdActivationReadResult
  transactionAbsent: boolean
  /** Null when the lock could not be read; the caller then reads it itself. */
  instanceLock: WslOCCdInstanceLockRead | null
  fenceOpen: boolean
}

type SnapshotPaths = {
  activation: string
  transaction: string
  instanceLock: string
  fence: string
}

function snapshotPaths(host: RemoteHostPlatform, remoteHome: string, userDataDir: string) {
  return {
    activation: occdActivationPath(host, remoteHome),
    transaction: occdActivationTransactionPath(host, remoteHome),
    instanceLock: joinRemotePath(host, userDataDir, OCCD_LOCK_FILE_NAME),
    fence: occdActivationFenceLockDir(host, remoteHome)
  }
}

export function wslOCCdConnectStateCommand(
  host: RemoteHostPlatform,
  paths: SnapshotPaths
): string {
  // PRESENT only when the whole file was read; a failed or oversized read is UNREADABLE.
  // `$(cat)` drops trailing newlines, so raws are not byte-exact; every consumer parses JSON.
  const read = (path: string): string => {
    const file = quotePosixShell(path)
    return (
      `if [ ! -e ${file} ] && [ ! -L ${file} ]; then printf '%s' ABSENT; ` +
      `elif [ -f ${file} ] && size=$(wc -c < ${file}) && [ "$size" -le ${RECORD_MAX_BYTES} ] && body=$(cat ${file}); ` +
      `then printf 'PRESENT\\n%s' "$body"; else printf '%s' UNREADABLE; fi; ` +
      `printf '\\n%s\\n' ${SECTION_END}`
    )
  }
  const lock = quotePosixShell(paths.instanceLock)
  // The pid as digits only; the parser drops the identity unless it matches the parsed lock.
  const holderIdentity =
    `occ_lock_pid=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' ${lock} 2>/dev/null | head -n 1); ` +
    `if [ -n "$occ_lock_pid" ]; then printf 'PID %s\\n' "$occ_lock_pid"; ` +
    `${wslGuestIdentityShellCommand('"$occ_lock_pid"')}; else printf '%s' NONE; fi; ` +
    `printf '\\n%s\\n' ${SECTION_END}`
  return [
    read(paths.activation),
    read(paths.transaction),
    read(paths.instanceLock),
    holderIdentity,
    probeInstallLockExistsCommand(host, paths.fence)
  ].join('; ')
}

type Section = { state: 'absent' } | { state: 'present'; raw: string } | { state: 'unreadable' }

function parseSection(text: string): Section | null {
  if (text === 'ABSENT') {
    return { state: 'absent' }
  }
  if (text === 'UNREADABLE') {
    return { state: 'unreadable' }
  }
  return text.startsWith('PRESENT\n') ? { state: 'present', raw: text.slice(8) } : null
}

function withHolderIdentity(
  lock: { state: 'present'; raw: string },
  section: string
): WslOCCdInstanceLockRead {
  const match = /^PID (\d+)\n([\s\S]*)$/.exec(section)
  if (!match) {
    return lock
  }
  const pid = Number(match[1])
  const guest = parseWslGuestIdentity(match[2] ?? '')
  return guest && Number.isSafeInteger(pid) ? { ...lock, holder: { pid, guest } } : lock
}

/** Null unless the output has exactly the shape the command prints. */
export function parseWslOCCdConnectState(output: string): WslOCCdConnectStateSnapshot | null {
  const parts = output.split(`\n${SECTION_END}\n`)
  if (parts.length !== 5) {
    return null
  }
  const [activation, transaction, instanceLock] = parts.slice(0, 3).map(parseSection)
  const fence = parts[4]?.trim()
  if (!activation || !transaction || !instanceLock || (fence !== 'LOCKED' && fence !== 'OPEN')) {
    return null
  }
  return {
    activation:
      activation.state === 'unreadable'
        ? { state: 'unreadable', reason: 'the connect snapshot could not read it' }
        : parseOCCdActivationRecord(activation.state === 'present' ? activation.raw : null),
    transactionAbsent:
      transaction.state !== 'unreadable' &&
      parseOCCdActivationTransaction(transaction.state === 'present' ? transaction.raw : null)
        .state === 'absent',
    instanceLock:
      instanceLock.state === 'unreadable'
        ? null
        : instanceLock.state === 'present'
          ? withHolderIdentity(instanceLock, parts[3] ?? '')
          : instanceLock,
    fenceOpen: fence === 'OPEN'
  }
}

/**
 * Reads the activation record through the snapshot, keeping the snapshot for later hints. Falls
 * back to the plain record read (which fails closed on an unreadable record) when it can't answer.
 */
export function createWslOCCdConnectStateReader() {
  let snapshot: WslOCCdConnectStateSnapshot | null = null
  return {
    // No hints when the record came from the fallback read rather than the snapshot.
    snapshot: (): WslOCCdConnectStateSnapshot | null =>
      snapshot?.activation.state === 'unreadable' ? null : snapshot,
    readActivationRecord: async (target: {
      conn: OCCdHostTransport
      host: RemoteHostPlatform
      signal?: AbortSignal
      remoteHome: string
      userDataDir: string
    }): Promise<OCCdActivationRecord> => {
      if (!isWindowsRemoteHost(target.host)) {
        const paths = snapshotPaths(target.host, target.remoteHome, target.userDataDir)
        // A failed snapshot only costs the per-file reads; an aborted signal stops those too.
        const output = await execOCCdRemote(
          target,
          wslOCCdConnectStateCommand(target.host, paths)
        ).catch(() => null)
        snapshot = output === null ? null : parseWslOCCdConnectState(output)
      }
      const activation = snapshot?.activation
      if (activation?.state === 'ok') {
        return activation.record
      }
      return activation?.state === 'absent'
        ? emptyOCCdActivationRecord()
        : readOCCdActivationRecord(target)
    }
  }
}

/** Later steps take the snapshot's hints only while the record it read is still the one acted on. */
export function wslOCCdConnectStateHints(
  snapshot: WslOCCdConnectStateSnapshot | null,
  snapshotRecord: OCCdActivationRecord
) {
  const current = (record: OCCdActivationRecord) => (record === snapshotRecord ? snapshot : null)
  return {
    instanceLock: (record: OCCdActivationRecord): WslOCCdInstanceLockRead | undefined =>
      current(record)?.instanceLock ?? undefined,
    deployPreRead: (record: OCCdActivationRecord) => {
      const fresh = current(record)
      return fresh ? { preRead: { record, fenceOpen: fresh.fenceOpen } } : {}
    }
  }
}
