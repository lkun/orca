// GC only occd-owned slots; pin active, rollback, live-daemon and journal versions, skipping collection when recovery state is unreadable.
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { OCCD_INSTALL_MODEL } from './remote-install-model'
import { gcOldRemoteInstallVersions } from './remote-install-gc'
import {
  occdGcPinnedDirNames,
  type OCCdActivationRecord
} from '../activation/occd-activation-record'
import {
  OCCD_NEVER_LAUNCHED,
  occdLivenessAnswerBlocksGc,
  occdLivenessProbeCommand
} from './occd-remote-launch'
import { gcRemoteNodeRuntimeStore } from './remote-node-runtime-store-gc'
import { readOCCdGcTransactionPins } from '../../ssh/occd-gc-transaction-pins'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { occdWindowsHomeOpCommand } from './occd-remote-windows-node'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { OCCD_INSTALL_COMPLETE_FILENAME } from '../../../shared/occd-artifacts'
import { OCCD_WINDOWS_LIVENESS_MANY_MARKER } from '../host-state/occd-windows-host-script'

type OCCdGcOptions = {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  currentDirAbsPath: string
  record: OCCdActivationRecord
  /** A live daemon can still execute an outgoing bundle no longer active or previous; keep its bytes. */
  liveDaemonVersion?: string | null
  /** Current executable hashes both pin runtimes and authorize runtime-store GC. */
  nodeRuntimePins?: readonly string[]
  /** Keep complete builds staged this recently; another desktop's deferred update may still want its own. */
  keepStagedWithinDays?: number
  signal?: AbortSignal
}

/** True when no stale version dir was left behind (skipped, kept or unlistable ones make it false). */
export async function gcOldOCCdVersions(options: OCCdGcOptions): Promise<boolean> {
  const keepDays = options.keepStagedWithinDays
  if (keepDays !== undefined && isWindowsRemoteHost(options.host)) {
    // The Windows host script cannot date staged builds, so keep them all.
    return false
  }
  const transaction = await readOCCdGcTransactionPins(options)
  if (transaction.state === 'keep-all') {
    console.warn('[occd-gc] An activation transaction is unreadable or unjournaled; skipping GC.')
    return false
  }
  let keptRecent = false
  const versionsClean = await gcOldRemoteInstallVersions(
    options.conn,
    OCCD_INSTALL_MODEL,
    options.remoteHome,
    options.currentDirAbsPath,
    options.host,
    {
      pinnedDirNames: [
        ...occdGcPinnedDirNames(options.record, options.liveDaemonVersion),
        ...transaction.dirNames
      ],
      // Screen Windows candidates together, then recheck dead candidates individually under the GC claim.
      ...(isWindowsRemoteHost(options.host)
        ? { resolveExtraPinnedDirNames: (candidates) => windowsLiveCandidates(options, candidates) }
        : keepDays !== undefined
          ? {
              resolveExtraPinnedDirNames: async (candidates) => {
                const recent = await recentlyStagedCandidates(options, candidates, keepDays)
                keptRecent = recent === null || recent.length > 0
                return recent
              }
            }
          : {}),
      isDirLive: (dir) => isOCCdInstallDirLive(options, dir)
    }
  )
  // Remove slots before runtimes so their references are released first.
  if (options.nodeRuntimePins?.length) {
    await gcRemoteNodeRuntimeStore(options.conn, options.host, options.remoteHome, {
      currentPins: options.nodeRuntimePins,
      signal: options.signal
    })
  }
  // A recent build kept now still needs pruning once it ages.
  return versionsClean && !keptRecent
}

/** True unless the slot's occd is proven not running from `dir`. */
export async function isOCCdInstallDirLive(
  options: Pick<OCCdGcOptions, 'conn' | 'host' | 'signal'>,
  dir: string
): Promise<boolean> {
  try {
    const probe = await execCommand(options.conn, occdLivenessProbeCommand(options.host, dir), {
      wrapCommand: options.host.commandDialect !== 'powershell',
      signal: options.signal
    })
    return occdLivenessAnswerBlocksGc(probe)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    // Failed probes cannot prove the tree is idle.
    return true
  }
}

/** Null means unknown host state and keeps every candidate; otherwise pin anything not proven dead. */
async function windowsLiveCandidates(
  options: OCCdGcOptions,
  candidates: readonly string[]
): Promise<readonly string[] | null> {
  const dirs = candidates.map((name) =>
    joinRemotePath(options.host, options.remoteHome, RELAY_REMOTE_DIR, name)
  )
  let output: string
  try {
    output = await execCommand(
      options.conn,
      occdWindowsHomeOpCommand(options.host, options.remoteHome, 'liveness-many', dirs),
      { wrapCommand: false, signal: options.signal }
    )
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return null
  }
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(`${OCCD_WINDOWS_LIVENESS_MANY_MARKER} `))
  const states = line?.slice(OCCD_WINDOWS_LIVENESS_MANY_MARKER.length + 1).split(',') ?? []
  if (states.length !== candidates.length) {
    return null
  }
  return candidates.filter(
    (_name, index) => states[index] !== 'DEAD' && states[index] !== OCCD_NEVER_LAUNCHED
  )
}

/** Null on any failure or unanswerable date, which keeps every candidate. */
async function recentlyStagedCandidates(
  options: OCCdGcOptions,
  candidates: readonly string[],
  days: number
): Promise<readonly string[] | null> {
  if (!Number.isInteger(days) || days < 1) {
    return null
  }
  const checks = candidates.map((name) => {
    const marker = quotePosixShell(
      joinRemotePath(
        options.host,
        options.remoteHome,
        RELAY_REMOTE_DIR,
        name,
        OCCD_INSTALL_COMPLETE_FILENAME
      )
    )
    // A find without -mtime must read as unknown, not as an old build.
    return (
      `if [ ! -e ${marker} ]; then :; elif recent=$(find ${marker} -mtime -${days} 2>/dev/null); then ` +
      `if [ -n "$recent" ]; then echo RECENT ${quotePosixShell(name)}; fi; else echo ERR; fi;`
    )
  })
  try {
    const output = await execCommand(options.conn, `${checks.join(' ')} echo ${RECENT_DONE}`, {
      signal: options.signal
    })
    const lines = output.split('\n').map((line) => line.trim())
    if (!lines.includes(RECENT_DONE) || lines.includes('ERR')) {
      return null
    }
    return candidates.filter((name) => lines.includes(`RECENT ${name}`))
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return null
  }
}

const RECENT_DONE = 'OCCD_RECENT_STAGED_DONE'
