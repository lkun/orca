/** Check snapshot room before stopping a serving incumbent (#30491). */
import { occdRemoteBaseDir } from '../managed-server/install/occd-remote-windows-node'
import { execOCCdRemoteOr } from '../managed-server/install/occd-remote-runtime-control'
import {
  OCCD_STATE_SNAPSHOT_DIR,
  type OCCdActivationRecord
} from '../managed-server/activation/occd-activation-record'
import {
  occdSnapshotShortfallKb,
  occdSnapshotShortfallMessage,
  occdSnapshotSpaceCommand,
  parseOCCdSnapshotSpace
} from '../managed-server/host-state/occd-state-snapshot-space'
import { joinRemotePath } from './ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { OCCdSlotOptions } from './occd-recovery-slot'

export const OCCD_SNAPSHOT_SPACE_INSUFFICIENT_CODE = 'occd_snapshot_space_insufficient'

export function occdSnapshotsRoot(options: Pick<OCCdSlotOptions, 'host' | 'remoteHome'>): string {
  return joinRemotePath(
    options.host,
    occdRemoteBaseDir(options.host, options.remoteHome),
    OCCD_STATE_SNAPSHOT_DIR
  )
}

/** Unknown room proceeds to authoritative capture; return a refusal only for proven insufficient space. */
export async function occdSnapshotRoomRefusal(
  options: OCCdSlotOptions,
  record: OCCdActivationRecord,
  fullVersion: string
): Promise<string | null> {
  const baseDir = occdRemoteBaseDir(options.host, options.remoteHome)
  const command = occdSnapshotSpaceCommand(
    options.host,
    options.userDataDir,
    occdSnapshotsRoot(options),
    baseDir,
    record.snapshot ? [record.snapshot.dirName] : []
  )
  if (!command) {
    return null
  }
  const space = parseOCCdSnapshotSpace(await measureRoom(options, command))
  const shortfall = occdSnapshotShortfallKb(space)
  return space && shortfall !== null
    ? occdSnapshotShortfallMessage(space, shortfall, {
        userDataDir: options.userDataDir,
        baseDir,
        fullVersion,
        active: record.active
      })
    : null
}

async function measureRoom(options: OCCdSlotOptions, command: string): Promise<string> {
  try {
    return await execOCCdRemoteOr(options, command)
  } catch (error) {
    // Unconfirmed read-only cleanup leaves room unknown; capture decides, unless caller cancelled.
    if (isUnconfirmedSshCommandTermination(error) && !options.signal?.aborted) {
      return ''
    }
    throw error
  }
}
