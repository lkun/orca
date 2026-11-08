// Shared-home locks need explicit operator confirmation: local silence cannot prove a remote holder exited.
import { readdirSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { hostname } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  acquireOCCdInstanceLock,
  OCCD_LOCK_FILE_NAME,
  parseOCCdInstanceLockRecord,
  type OCCdInstanceLockHooks,
  type OCCdLockRecord
} from './occd-instance-lock'
import { readBoundedLockFile } from './occd-instance-lock-reclaim'
import { occdLockHolderLocality } from './occd-lock-holder-locality'
import { OCCD_LOCK_FRESH_MS, occdLockPeer, occdLockSelf } from './occd-lock-clone-machine'
import { occdDataRootIsOnLocalDisk } from './occd-data-root-locality'
import { readOCCdProcessIncarnation } from './occd-process-start-time'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'
import { resolveUserDataPath } from './occd-app-paths'
import { profileStateAccessMachineIdentity } from '../persistence/profile-state/profile-state-access-identity'
import { readRuntimeMetadata } from '../runtime/rpc/server/runtime-metadata'
import { RUNTIME_SOCKET_NAME_REGEX } from '../runtime/rpc/server/runtime-rpc-socket-metadata'
import {
  OCCD_RECLAIM_STALE_LOCK_FLAG,
  OCCD_STALE_LOCK_DATA_ROOT_FLAG,
  OCCD_STALE_LOCK_EXPECT_NONCE_FLAG,
  OCCD_STALE_LOCK_RECLAIM_EXIT_CODES,
  type OCCdReclaimHintRuntime,
  type OCCdStaleLockEvidence,
  type OCCdStaleLockReclaimStatus
} from '../../shared/occd-stale-lock-reclaim'

// A new holder may not listen yet, and NFS attribute caching can age a live heartbeat this much.
export const OCCD_STALE_LOCK_MIN_AGE_MS = OCCD_LOCK_FRESH_MS
const ENDPOINT_PROBE_TIMEOUT_MS = 1_500

/** Silent requires OS-confirmed absence of a listener; errors leave ownership unknown. */
export type OCCdEndpointProbe = 'answers' | 'silent' | 'unknown'

export type OCCdStaleLockReclaimHooks = {
  now?: () => number
  hostname?: () => string
  bootId?: () => string | null
  bootStartedAtMs?: () => number | null
  machineIdentity?: () => string | null
  dataRootIsOnLocalDisk?: (dataRoot: string) => boolean
  probeEndpoint?: (endpoint: string) => Promise<OCCdEndpointProbe>
  lockHooks?: OCCdInstanceLockHooks
}

export type OCCdStaleLockReclaimResult = {
  status: OCCdStaleLockReclaimStatus
  exitCode: number
  lockPath: string
  message: string
  evidence?: OCCdStaleLockEvidence
}

export async function reclaimStaleOCCdInstanceLock(
  dataRoot: string,
  options: {
    yes: boolean
    expectNonce?: string
    hintRuntime: OCCdReclaimHintRuntime | null
  },
  hooks: OCCdStaleLockReclaimHooks = {}
): Promise<OCCdStaleLockReclaimResult> {
  const lockPath = join(dataRoot, OCCD_LOCK_FILE_NAME)
  const result = (
    status: OCCdStaleLockReclaimStatus,
    message: string,
    evidence?: OCCdStaleLockEvidence
  ): OCCdStaleLockReclaimResult => ({
    status,
    exitCode: OCCD_STALE_LOCK_RECLAIM_EXIT_CODES[status],
    lockPath,
    message,
    ...(evidence ? { evidence } : {})
  })
  const contents = readBoundedLockFile(lockPath)
  if (contents === null) {
    // Permission or I/O errors can hide a lock; only absence permits none.
    return lockIsAbsent(lockPath)
      ? result(
          'none',
          `No occd instance lock at ${lockPath}. If a start reported a lock in another data ` +
            `root, re-run with ${OCCD_STALE_LOCK_DATA_ROOT_FLAG} and the directory it named.`
        )
      : result('refused', `The lock ${lockPath} cannot be read. Check it by hand.`)
  }
  const holder = parseOCCdInstanceLockRecord(contents)
  if (!holder) {
    return result('refused', `The lock ${lockPath} is not a complete record. Check it by hand.`)
  }
  if (options.expectNonce !== undefined && holder.nonce !== options.expectNonce) {
    return result('refused', 'The lock changed after you checked it. Check it again.')
  }
  const currentBoot = (hooks.bootId ?? currentBootId)()
  const checked = await checkStaleLock(dataRoot, lockPath, holder, currentBoot, hooks)
  if ('refusal' in checked) {
    return result('refused', `${checked.refusal} Not reclaiming ${lockPath}.`)
  }
  const { evidence } = checked
  const found =
    `${holder.role === 'desktop' ? 'The OCC desktop app' : 'occd'} pid ${evidence.pid} on ` +
    `host ${evidence.host} took ${lockPath} ${evidence.ageMinutes} minutes ago, in boot ` +
    `${evidence.bootId} (this machine is now in boot ${evidence.currentBootId}), and nothing ` +
    'answers on this machine at its endpoints. The host name and boot checks cannot rule out ' +
    'another machine with the same host name that shares this home.'
  if (!options.yes) {
    return result(
      'eligible',
      `${found}\nMake sure no other machine sharing this home runs OCC for this profile, then ` +
        'run the same command again with --yes added.',
      evidence
    )
  }
  try {
    // Normal acquisition rechecks identity and atomically reclaims only this record.
    acquireOCCdInstanceLock(dataRoot, {
      ...hooks.lockHooks,
      reclaimHintRuntime: options.hintRuntime,
      // Also reclaim abandoned reclaimers from earlier boots of this host.
      reclaimConfirmed: (record, role) =>
        role === 'holder'
          ? record.nonce === holder.nonce
          : record.host === holder.host && !!record.bootId && record.bootId !== currentBoot
    }).release()
  } catch (error) {
    return result('refused', error instanceof Error ? error.message : String(error), evidence)
  }
  return result('reclaimed', `${found}\nReclaimed ${lockPath}. OCC can start now.`, evidence)
}

async function checkStaleLock(
  dataRoot: string,
  lockPath: string,
  holder: OCCdLockRecord,
  bootId: string | null,
  hooks: OCCdStaleLockReclaimHooks
): Promise<{ refusal: string } | { evidence: OCCdStaleLockEvidence }> {
  const machineIdentity = (hooks.machineIdentity ?? profileStateAccessMachineIdentity)()
  // Judge as a normal start does, so "a normal start reclaims it" stays true.
  const self = occdLockSelf(
    { ...(machineIdentity ? { machineIdentity } : {}), ...(bootId ? { bootId } : {}) },
    (hooks.now ?? Date.now)(),
    hooks.bootStartedAtMs?.()
  )
  const locality = occdLockHolderLocality(occdLockPeer(holder, lockPath), self, () =>
    (hooks.dataRootIsOnLocalDisk ?? occdDataRootIsOnLocalDisk)(dataRoot)
  )
  if (locality === 'local') {
    return {
      refusal:
        'This machine can judge this lock itself, so a normal start reclaims it if its holder exited.'
    }
  }
  if (locality === 'foreign') {
    return { refusal: 'The lock was written by another machine (a different machine id).' }
  }
  const host = (hooks.hostname ?? hostname)()
  if (!holder.host) {
    return {
      refusal: 'The lock does not record which host wrote it (an older occd wrote it).'
    }
  }
  if (holder.host !== host) {
    return { refusal: `The lock was written on host ${holder.host}, not this host (${host}).` }
  }
  if (!holder.bootId || !bootId) {
    return { refusal: 'The lock or this machine has no boot id to compare.' }
  }
  const now = (hooks.now ?? Date.now)()
  const writtenMs = Math.max(Date.parse(holder.acquiredAt), statOrNull(lockPath)?.mtimeMs ?? now)
  if (!(now - writtenMs >= OCCD_STALE_LOCK_MIN_AGE_MS)) {
    return { refusal: `The lock is less than ${OCCD_STALE_LOCK_MIN_AGE_MS / 60_000} minutes old.` }
  }
  const endpoints = holderEndpoints(dataRoot, holder.pid)
  if (!endpoints) {
    return { refusal: 'The runtime record in the data root cannot be read.' }
  }
  const probe = hooks.probeEndpoint ?? probeOCCdEndpoint
  for (const endpoint of endpoints) {
    const answer = await probe(endpoint)
    if (answer === 'answers') {
      return {
        refusal: `Something on this machine answers at ${endpoint}, so it may still be running.`
      }
    }
    if (answer === 'unknown') {
      return { refusal: `Whether anything answers at ${endpoint} could not be checked.` }
    }
  }
  return {
    evidence: {
      pid: holder.pid,
      host: holder.host,
      bootId: holder.bootId,
      currentBootId: bootId,
      ageMinutes: Math.round((now - writtenMs) / 60_000),
      nonce: holder.nonce
    }
  }
}

/** Null leaves endpoints unverifiable when runtime metadata is unreadable. */
function holderEndpoints(dataRoot: string, pid: number): string[] | null {
  const endpoints = new Set<string>()
  try {
    const metadata = readRuntimeMetadata(dataRoot)
    if (metadata?.pid === pid) {
      for (const transport of metadata.transports ?? []) {
        endpoints.add(transport.endpoint)
      }
    }
    for (const entry of readdirSync(dataRoot)) {
      if (RUNTIME_SOCKET_NAME_REGEX.exec(entry)?.[1] === String(pid)) {
        endpoints.add(join(dataRoot, entry))
      }
    }
  } catch {
    return null
  }
  return [...endpoints]
}

export function probeOCCdEndpoint(endpoint: string): Promise<OCCdEndpointProbe> {
  let target: { path: string } | { host: string; port: number }
  try {
    const url = /^wss?:\/\//u.test(endpoint) ? new URL(endpoint) : null
    const defaultPort = url?.protocol === 'wss:' ? 443 : 80
    // URL.hostname retains IPv6 brackets, which the socket API rejects.
    target = url
      ? { host: url.hostname.replace(/^\[|\]$/gu, ''), port: Number(url.port || defaultPort) }
      : { path: endpoint }
  } catch {
    return Promise.resolve('unknown')
  }
  return new Promise((resolve) => {
    const socket = createConnection(target)
    const finish = (answer: OCCdEndpointProbe): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => finish('unknown'), ENDPOINT_PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish('answers'))
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'silent' : 'unknown')
    )
  })
}

function currentBootId(): string | null {
  return readOCCdProcessIncarnation(process.pid)?.bootId ?? null
}

function lockIsAbsent(path: string): boolean {
  try {
    statSync(path)
    return false
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}

function statOrNull(path: string): { mtimeMs: number } | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

export function printOCCdStaleLockReclaimResult(
  result: OCCdStaleLockReclaimResult,
  json: boolean
): void {
  if (json) {
    console.log(JSON.stringify(result))
    return
  }
  ;(result.status === 'reclaimed' ? console.log : console.error)(result.message)
}

export async function runOCCdStaleLockReclaimCommandAndExit(argv: string[]): Promise<never> {
  const args = argv.slice(1)
  const json = args.includes('--json')
  const valueFlags = [OCCD_STALE_LOCK_DATA_ROOT_FLAG, OCCD_STALE_LOCK_EXPECT_NONCE_FLAG]
  const valueIndexes = valueFlags.map((flag) => args.indexOf(flag)).filter((index) => index !== -1)
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag)
    return index === -1 ? undefined : (args[index + 1] ?? '')
  }
  const dataRoot = valueOf(OCCD_STALE_LOCK_DATA_ROOT_FLAG) ?? resolveUserDataPath()
  const expectNonce = valueOf(OCCD_STALE_LOCK_EXPECT_NONCE_FLAG)
  const unknown = args.filter(
    (arg, index) =>
      !['--yes', '--json', ...valueFlags].includes(arg) && !valueIndexes.includes(index - 1)
  )
  // Reject missing flag values before they can select another data root or nonce.
  const badValue = (value: string | undefined): boolean =>
    value !== undefined && (!value.trim() || value.startsWith('-'))
  if (!dataRoot || badValue(dataRoot) || badValue(expectNonce) || unknown.length) {
    console.error(
      `Usage: occd ${OCCD_RECLAIM_STALE_LOCK_FLAG} [${OCCD_STALE_LOCK_DATA_ROOT_FLAG} <dir>] [${OCCD_STALE_LOCK_EXPECT_NONCE_FLAG} <nonce>] [--yes] [--json]`
    )
    process.exit(OCCD_STALE_LOCK_RECLAIM_EXIT_CODES.refused)
  }
  const result = await reclaimStaleOCCdInstanceLock(dataRoot, {
    yes: args.includes('--yes'),
    ...(expectNonce !== undefined ? { expectNonce } : {}),
    hintRuntime: { execPath: process.execPath, entry: process.argv[1] }
  })
  printOCCdStaleLockReclaimResult(result, json)
  process.exit(result.exitCode)
}
