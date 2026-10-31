import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import {
  OCCD_MOBILE_WEB_DIR,
  OCCD_MOBILE_WEB_MANIFEST,
  OCCD_NODE_RUNTIME_MARKER_FILENAME,
  OCCD_SERVER_TARGET_FILENAME,
  OCCD_TEMPLATE_MANIFEST_FILENAME,
  OCCD_TEMPLATE_TARGETS_DIR,
  OCCD_VERSION_FILENAME,
  compareCodeUnits,
  isOCCdMobileWebAssetPath,
  occdArtifactFilenames,
  occdTemplateCommonFilenames,
  occdTemplatePackagedRipgrep,
  occdTemplateTargetFilenames
} from '../../shared/occd-artifacts'
import { pinnedNodeRuntimeAsset, type NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import { findOCCdCachePath } from '../node-runtime/occd-cache-path'
import type { PinnedRuntimeMaterializeOptions } from '../node-runtime/pinned-runtime-materializer'
import { readOCCdArtifactVerificationRecord } from './occd-artifact-verification-record'
import {
  isCompleteArtifact,
  rememberVerification,
  sameHashes,
  signSlot,
  slotMatchesRecord,
  verifiedArtifactIdentity,
  type ArtifactSource,
  type ExpectedSha256
} from './occd-artifact-source-verification'
import { OCCdTemplateManifestSchema, type OCCdTemplateManifest } from './occd-template-manifest'
import { OCCdArtifactsUnavailableError, OCCdHostUnsupportedError } from './occd-host-unavailable'

type MaterializeOptions = PinnedRuntimeMaterializeOptions & {
  templateDir?: string
  cacheRoot?: string
  /** WSL wake only: trust recorded stat signatures instead of rehashing bytes. */
  trustVerificationRecord?: boolean
}

const materializations = new Map<string, Promise<string>>()
// Retain handed-out slots: concurrent deployments may still be reading them.
const materializedVersions = new Set<string>()

export function materializedOCCdArtifactVersions(): ReadonlySet<string> {
  return materializedVersions
}

/** Reference the runtime separately from the verified slot. */
export async function materializeOCCdArtifact(
  target: NodeRuntimeTarget,
  options: MaterializeOptions = {}
): Promise<string> {
  options.signal?.throwIfAborted()
  const templateDir = options.templateDir ?? resolveOCCdTemplateDir()
  const cacheRoot =
    options.cacheRoot ?? join(getAppEnvironment().getPath('userData'), 'occd-artifacts')
  const trustVerificationRecord = options.trustVerificationRecord === true
  // SSH/local callers must not join fills that trust verification records.
  const key = `${templateDir}\0${cacheRoot}\0${target}\0${trustVerificationRecord}`
  const existing = materializations.get(key)
  if (existing) {
    return waitForPromiseWithSignal(existing, options.signal)
  }
  // Cancellation detaches one caller; the bounded cache fill still serves other deployments.
  const pending = assembleOCCdArtifact({
    templateDir,
    cacheRoot,
    target,
    trustVerificationRecord
  }).finally(() => materializations.delete(key))
  materializations.set(key, pending)
  return waitForPromiseWithSignal(pending, options.signal)
}

export async function assembleOCCdArtifact(args: {
  templateDir: string
  cacheRoot: string
  target: NodeRuntimeTarget
  manifest?: OCCdTemplateManifest
  now?: () => number
  /** Disabled for SSH/local serve: hash every launch without reading/writing records. */
  trustVerificationRecord?: boolean
}): Promise<string> {
  const trust = args.trustVerificationRecord === true
  const manifest = args.manifest ?? (await readTemplateManifest(args.templateDir))
  const mobileWebAssets = templateMobileWebAssets(manifest)
  const sources = artifactSources(args.templateDir, args.target, manifest, mobileWebAssets)
  const expected = expectedTemplateSha256(args.target, manifest, mobileWebAssets)
  const targetRoot = join(args.cacheRoot, args.target)
  const nowMs = (args.now ?? Date.now)()
  const record = trust ? await readOCCdArtifactVerificationRecord(targetRoot) : null
  const identity = await verifiedArtifactIdentity(sources, expected, record, nowMs, trust)
  await verifyTemplateMarkers(args.templateDir, args.target)
  const { fullVersion, sourceHashes } = identity
  const recordedSlot =
    record && record.contentDigest === identity.contentDigest && sameHashes(record, sourceHashes)
      ? record.slot
      : null
  let slotFromRecord = false
  const cached = await findOCCdCachePath(
    (attempt) => join(targetRoot, `${fullVersion}${attempt ? `.repair-${attempt}` : ''}`),
    async (path) => {
      slotFromRecord = await slotMatchesRecord(path, fullVersion, sources, recordedSlot, nowMs)
      return slotFromRecord || isCompleteArtifact(path, fullVersion, sources, sourceHashes)
    }
  )
  const targetDir = cached.path
  materializedVersions.add(fullVersion)
  if (cached.verified) {
    const now = new Date()
    await utimes(targetDir, now, now).catch(() => undefined)
    if (trust) {
      const slot = slotFromRecord ? recordedSlot : await signSlot(targetDir, sources, nowMs)
      await rememberVerification(targetRoot, record, identity, slot)
    }
    return targetDir
  }
  await mkdir(targetRoot, { recursive: true })
  const stagingDir = join(targetRoot, `.staging-${process.pid}-${randomUUID()}`)
  try {
    for (const source of sources) {
      const destination = join(stagingDir, source.filename)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source.path, destination)
      if (source.executable && !args.target.startsWith('win32-')) {
        await chmod(destination, 0o755)
      }
    }
    await writeFile(join(stagingDir, OCCD_VERSION_FILENAME), `${fullVersion}\n`, { mode: 0o600 })
    if (!(await isCompleteArtifact(stagingDir, fullVersion, sources, sourceHashes))) {
      throw new Error('OCCd artifact sources changed while copying')
    }
    try {
      await rename(stagingDir, targetDir)
    } catch (error) {
      if (!(await isCompleteArtifact(targetDir, fullVersion, sources, sourceHashes))) {
        throw new Error(`OCCd artifact cache entry is unavailable or corrupted: ${targetDir}`, {
          cause: error
        })
      }
    }
    if (trust) {
      // Fresh copies are unsettled, so the next launch must hash again.
      await rememberVerification(targetRoot, record, identity, null)
    }
    return targetDir
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

function isExecutableArtifact(filename: string): boolean {
  return /(?:^|\/)(?:rg|spawn-helper)$/.test(filename)
}

function artifactSources(
  templateDir: string,
  target: NodeRuntimeTarget,
  manifest: OCCdTemplateManifest,
  mobileWebAssets: readonly string[]
): ArtifactSource[] {
  const targetDir = join(templateDir, OCCD_TEMPLATE_TARGETS_DIR, target)
  const targetManifest = manifest.targets[target]
  if (!targetManifest) {
    throw new OCCdHostUnsupportedError(`Packaged occd template does not support ${target}`)
  }
  const packagedRipgrep = occdTemplatePackagedRipgrep(
    manifest.schemaVersion,
    target,
    targetManifest.packagedRipgrep
  )
  const targetFiles = new Set(occdTemplateTargetFilenames(target))
  const required = occdArtifactFilenames(target, mobileWebAssets).map((filename) => ({
    filename,
    path: join(
      filename === packagedRipgrep
        ? dirname(templateDir)
        : targetFiles.has(filename)
          ? targetDir
          : templateDir,
      ...filename.split('/')
    ),
    executable: isExecutableArtifact(filename)
  }))
  if (!targetManifest.browserName) {
    return required
  }
  return [
    ...required,
    {
      filename: targetManifest.browserName,
      path: join(
        targetManifest.packagedBrowser ? dirname(templateDir) : targetDir,
        targetManifest.browserName
      ),
      executable: true
    }
  ]
}

function expectedTemplateSha256(
  target: NodeRuntimeTarget,
  manifest: OCCdTemplateManifest,
  mobileWebAssets: readonly string[]
): Map<string, ExpectedSha256> {
  const targetManifest = manifest.targets[target]
  if (!targetManifest) {
    throw new OCCdHostUnsupportedError(`Packaged occd template does not support ${target}`)
  }
  const expected = new Map<string, ExpectedSha256>()
  for (const filename of occdTemplateCommonFilenames(mobileWebAssets)) {
    const sha256 = manifest.commonSha256[filename]
    if (!sha256) {
      throw new Error(`Packaged occd template manifest omits ${filename}`)
    }
    expected.set(filename, { sha256, label: `occd template ${filename}` })
  }
  for (const filename of occdTemplateTargetFilenames(target)) {
    const sha256 = targetManifest.files[filename]
    if (!sha256) {
      throw new Error(`Packaged occd template manifest omits ${target} ${filename}`)
    }
    expected.set(filename, { sha256, label: `${target} ${filename}` })
  }
  if (targetManifest.browserName && targetManifest.browserSha256) {
    // Browser names must not override required-file digests.
    if (expected.has(targetManifest.browserName)) {
      throw new Error(`Packaged occd template ${target} browser name collides with a slot file`)
    }
    expected.set(targetManifest.browserName, {
      sha256: targetManifest.browserSha256,
      label: `${target} browser`
    })
  }
  return expected
}

/** Read asset names from the verified template manifest without extra WSL-wake file reads. */
function templateMobileWebAssets(manifest: OCCdTemplateManifest): string[] {
  const prefix = `${OCCD_MOBILE_WEB_DIR}/`
  const assets = Object.keys(manifest.commonSha256).filter(
    (filename) => filename.startsWith(prefix) && filename !== OCCD_MOBILE_WEB_MANIFEST
  )
  // Asset names become slot copy destinations; reject paths that escape.
  const unsafe = assets.find(
    (filename) => !isOCCdMobileWebAssetPath(filename.slice(prefix.length))
  )
  if (unsafe) {
    throw new Error(`Packaged occd template names an unsafe page asset: ${unsafe}`)
  }
  return assets.sort(compareCodeUnits)
}

async function readTemplateManifest(templateDir: string): Promise<OCCdTemplateManifest> {
  return OCCdTemplateManifestSchema.parse(
    JSON.parse(await readFile(join(templateDir, OCCD_TEMPLATE_MANIFEST_FILENAME), 'utf8'))
  )
}

async function verifyTemplateMarkers(
  templateDir: string,
  target: NodeRuntimeTarget
): Promise<void> {
  const targetDir = join(templateDir, OCCD_TEMPLATE_TARGETS_DIR, target)
  if ((await readFile(join(targetDir, OCCD_SERVER_TARGET_FILENAME), 'utf8')).trim() !== target) {
    throw new Error(`Packaged occd template target identity does not match ${target}`)
  }
  // Match this client’s runtime pin: it is the runtime the client will upload.
  const runtimeReference = await readFile(
    join(targetDir, OCCD_NODE_RUNTIME_MARKER_FILENAME),
    'utf8'
  )
  if (runtimeReference.trim() !== pinnedNodeRuntimeAsset(target).executableSha256) {
    throw new Error(`Packaged occd template ${target} does not reference the pinned Node`)
  }
}

export function getOCCdTemplateCandidates(): string[] {
  const candidates: string[] = []
  if (process.env.OCC_OCCD_TEMPLATE_PATH) {
    candidates.push(process.env.OCC_OCCD_TEMPLATE_PATH)
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'occd-template'))
  }
  const appPath = getAppEnvironment().getAppPath()
  candidates.push(
    join(appPath, 'out', 'occd-template'),
    join(appPath, 'resources', 'occd-template')
  )
  return [...new Set(candidates)]
}

export function hasOCCdTemplate(): boolean {
  return getOCCdTemplateCandidates().some((candidate) => existsSync(candidate))
}

function resolveOCCdTemplateDir(): string {
  const found = getOCCdTemplateCandidates().find((candidate) => existsSync(candidate))
  if (!found) {
    throw new OCCdArtifactsUnavailableError('The packaged occd deployment template is missing')
  }
  return found
}

export function resetOCCdArtifactMaterializationsForTests(): void {
  materializations.clear()
}
