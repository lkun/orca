// Consume clean idle-stop evidence once; discard failed stops so later crashes cannot inherit it.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  OCCD_IDLE_STOP_RECORD_FILENAME,
  OCCdIdleStopRecordSchema,
  type OCCdIdleStopRecord
} from '../../shared/occd-idle-exit'
import type { OCCdIdleExitEvidence } from './occd-idle-exit-monitor'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'

const RECORD_MAX_BYTES = 16 * 1024

export function occdIdleStopRecordPath(userDataPath: string): string {
  return join(userDataPath, OCCD_IDLE_STOP_RECORD_FILENAME)
}

export function writeOCCdIdleStopRecord(
  userDataPath: string,
  evidence: OCCdIdleExitEvidence,
  version: string
): void {
  const record: OCCdIdleStopRecord = {
    schemaVersion: 1,
    kind: 'occd_idle_stop',
    pid: process.pid,
    version,
    quietSince: new Date(evidence.quietSince).toISOString(),
    stoppedAt: new Date(evidence.stoppedAt).toISOString(),
    idleTimeoutMs: evidence.timeoutMs
  }
  if (!writeDurableSecureJsonFile(occdIdleStopRecordPath(userDataPath), record)) {
    throw new Error('occd_idle_stop_record_permissions_unconfirmed')
  }
}

export function consumeOCCdIdleStopRecord(userDataPath: string): OCCdIdleStopRecord | null {
  const path = occdIdleStopRecordPath(userDataPath)
  let record: OCCdIdleStopRecord | null = null
  try {
    const raw = readNodeFileSyncWithinLimit(path, RECORD_MAX_BYTES).buffer.toString('utf8')
    record = OCCdIdleStopRecordSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    console.error('[occd] ignoring an unreadable idle-stop record:', error)
  }
  rmSync(path, { force: true })
  return record
}

export function discardOCCdIdleStopRecord(userDataPath: string): void {
  rmSync(occdIdleStopRecordPath(userDataPath), { force: true })
}
