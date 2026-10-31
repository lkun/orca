// Unreadable activation records must fail closed; treating them as absent could overwrite a live install and its rollback target.
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import {
  OCCD_ACTIVATION_FILENAME,
  emptyOCCdActivationRecord,
  parseOCCdActivationRecord,
  serializeOCCdActivationRecord,
  type OCCdActivationReadResult,
  type OCCdActivationRecord
} from './occd-activation-record'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  readBoundedOCCdRemoteRecord,
  writeAtomicOCCdRemoteRecord
} from '../install/occd-remote-record-file'

const OCCD_ACTIVATION_RECORD_MAX_BYTES = 64 * 1024

type ActivationRecordTarget = {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  signal?: AbortSignal
}

export function occdActivationPath(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, OCCD_ACTIVATION_FILENAME)
}

async function readActivationRecordState(
  options: ActivationRecordTarget
): Promise<OCCdActivationReadResult> {
  const read = await readBoundedOCCdRemoteRecord(
    options,
    occdActivationPath(options.host, options.remoteHome),
    OCCD_ACTIVATION_RECORD_MAX_BYTES
  )
  return read.state === 'absent' ? read : parseOCCdActivationRecord(read.raw)
}

export async function readOCCdActivationRecord(
  options: ActivationRecordTarget
): Promise<OCCdActivationRecord> {
  const parsed = await readActivationRecordState(options)
  if (parsed.state === 'ok') {
    return parsed.record
  }
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's occd activation record: ${parsed.reason}`)
  }
  return emptyOCCdActivationRecord()
}

/** Refuse replacement of unreadable records, including schemas written by newer clients. */
export async function writeOCCdActivationRecord(
  options: ActivationRecordTarget,
  record: OCCdActivationRecord
): Promise<void> {
  const existing = await readActivationRecordState(options)
  if (existing.state === 'unreadable') {
    throw new Error(`Refusing to overwrite this host's occd activation record: ${existing.reason}`)
  }
  await writeAtomicOCCdRemoteRecord(
    options,
    occdActivationPath(options.host, options.remoteHome),
    serializeOCCdActivationRecord(record)
  )
}
