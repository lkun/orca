// Bound persistent artifact caches while retaining materialized, live-server and daemon slots.
// Unknown machine/boot ownership must preserve slots too.
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeRuntimeAsset } from '../../shared/node-runtime-pin'
import { OCCD_LOCK_FILE_NAME, readOCCdInstanceLockRecord } from './occd-instance-lock'
import { occdPeerPidIsJudgeableHere } from './occd-lock-holder-locality'
import { materializedOCCdArtifactVersions } from './occd-artifact-materializer'
import { occdArtifactSlotVersion } from './occd-artifact-slot-name'
import { isProcessAlive } from '../daemon/endpoint/identity/daemon-process-inspection'
import {
  defaultOCCdSlotPeerJudge,
  liveDaemonOCCdSlots,
  type OCCdSlotPeerJudge
} from './occd-daemon-slot-pins'

/** In-use slot plus two others, or the newest three when none is in use. */
const OCCD_ARTIFACT_CACHE_KEEP = 3

type OCCdArtifactCachePruneOptions = {
  keep?: number
  inUseVersions?: ReadonlySet<string>
}

/** Evict old version slots per target, keeping the in-use version and the newest others.
 *  Only names that parse as slots are candidates: `runtimes/` and staging dirs are never evicted (#38181). */
export async function pruneOCCdArtifactCache(
  cacheRoot: string,
  options: OCCdArtifactCachePruneOptions = {}
): Promise<string[]> {
  const keep = options.keep ?? OCCD_ARTIFACT_CACHE_KEEP
  const inUse = options.inUseVersions ?? new Set<string>()
  const removed: string[] = []
  for (const target of await listNames(cacheRoot)) {
    // Only target directories hold slots; `node/` is the runtime archive cache.
    if (!nodeRuntimeAsset(target)) {
      continue
    }
    const targetRoot = join(cacheRoot, target)
    const slots = await Promise.all(
      (await listNames(targetRoot)).flatMap((name) => {
        const version = occdArtifactSlotVersion(name)
        return version
          ? [mtimeOf(join(targetRoot, name)).then((mtimeMs) => ({ name, version, mtimeMs }))]
          : []
      })
    )
    const present = slots.filter(
      (slot): slot is { name: string; version: string; mtimeMs: number } => slot.mtimeMs !== null
    )
    // The in-use version consumes one keep slot; otherwise retain the newest keep versions.
    const othersToKeep = present.some((slot) => inUse.has(slot.version)) ? keep - 1 : keep
    const others = present
      .filter((slot) => !inUse.has(slot.version))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const [index, slot] of others.entries()) {
      if (index < othersToKeep) {
        continue
      }
      const path = join(targetRoot, slot.name)
      try {
        await rm(path, { recursive: true, force: true })
        removed.push(path)
      } catch (error) {
        console.warn(`[occd-artifacts] could not evict ${path}:`, error)
      }
    }
  }
  return removed
}

export function pruneDesktopOCCdArtifactCache(
  userDataPath: string,
  alsoInUse: readonly string[] = []
): Promise<string[]> {
  const cacheRoot = join(userDataPath, 'occd-artifacts')
  const judge = defaultOCCdSlotPeerJudge()
  const daemonSlots = liveDaemonOCCdSlots(userDataPath, cacheRoot, isProcessAlive, judge)
  if (!daemonSlots) {
    // An unreadable daemon record could name any slot; evicting nothing is the safe answer.
    return Promise.resolve([])
  }
  const live = liveLocalOCCdServeVersion(userDataPath, isProcessAlive, judge)
  return pruneOCCdArtifactCache(cacheRoot, {
    inUseVersions: new Set([
      ...materializedOCCdArtifactVersions(),
      ...(live ? [live] : []),
      ...daemonSlots.flatMap((slot) => occdArtifactSlotVersion(slot) ?? []),
      ...alsoInUse
    ])
  })
}

/** Keep slots used by local servers, including unverifiable ownership from other machines/boots. */
export function liveLocalOCCdServeVersion(
  userDataPath: string,
  isAlive: (pid: number) => boolean = isProcessAlive,
  judge: OCCdSlotPeerJudge = defaultOCCdSlotPeerJudge()
): string | null {
  const record = readOCCdInstanceLockRecord(join(userDataPath, OCCD_LOCK_FILE_NAME))
  if (!record || record.role === 'desktop') {
    return null
  }
  const judgeable = occdPeerPidIsJudgeableHere(record, judge.self, () =>
    judge.dataRootIsOnLocalDisk(userDataPath)
  )
  return !judgeable || isAlive(record.pid) ? record.version : null
}

async function listNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

async function mtimeOf(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? info.mtimeMs : null
  } catch {
    return null
  }
}
