import { createHash } from 'node:crypto'
import type * as NodeFs from 'node:fs'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pruneOCCdArtifactCache } from './occd-artifact-cache-retention'
import { z } from 'zod'
import {
  NODE_RUNTIME_ASSETS,
  NODE_RUNTIME_COMPAT_ASSETS,
  pinnedNodeRuntimeAsset,
  type NodeRuntimeTarget
} from '../../shared/node-runtime-pin'
import {
  OCCD_BUILD_TARGET_FILENAME,
  OCCD_MOBILE_WEB_MANIFEST,
  OCCD_NODE_RUNTIME_MARKER_FILENAME,
  OCCD_SERVER_TARGET_FILENAME,
  OCCD_TEMPLATE_MANIFEST_FILENAME,
  OCCD_TEMPLATE_TARGETS_DIR,
  OCCD_VERSION_FILENAME,
  occdArtifactFilenames,
  occdRipgrepArtifact,
  occdTemplateCommonFilenames,
  occdTemplateTargetFilenames
} from '../../shared/occd-artifacts'
import { readOCCdArtifactIdentity } from './occd-artifact-identity'
import { OCCD_ARTIFACT_VERIFICATION_RECORD_FILENAME } from './occd-artifact-verification-record'
import {
  getAppEnvironment,
  hasAppEnvironment,
  setAppEnvironment,
  type AppEnvironment
} from '../../shared/app-environment'
import {
  assembleOCCdArtifact,
  getOCCdTemplateCandidates,
  materializeOCCdArtifact,
  resetOCCdArtifactMaterializationsForTests
} from './occd-artifact-materializer'

const TARGET = 'linux-x64-glibc' as const
const PAGE_ASSETS = ['out/mobile-web/index.html']
const fileReads = vi.hoisted(() => ({ count: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      fileReads.count += 1
      return actual.createReadStream(...args)
    }
  }
})
const temporaryDirs: string[] = []

afterEach(() => {
  resetOCCdArtifactMaterializationsForTests()
  vi.clearAllMocks()
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

const ManifestSchema = z
  .object({
    targets: z.record(
      z.string(),
      z.object({ files: z.record(z.string(), z.string()) }).passthrough()
    ),
    commonSha256: z.record(z.string(), z.string())
  })
  .passthrough()

function targetContents(target: NodeRuntimeTarget, filename: string): string {
  if (filename === OCCD_SERVER_TARGET_FILENAME) {
    return `${target}\n`
  }
  if (filename === OCCD_NODE_RUNTIME_MARKER_FILENAME) {
    return `${pinnedNodeRuntimeAsset(target).executableSha256}\n`
  }
  return `${target}:${filename}`
}

function commonContents(filename: string): string {
  if (filename === OCCD_MOBILE_WEB_MANIFEST) {
    return JSON.stringify({ assets: [{ path: 'index.html' }] })
  }
  return filename === 'occd.js' ? 'occd-entry' : filename
}

function createTemplate(target: NodeRuntimeTarget = TARGET): {
  templateDir: string
  cacheRoot: string
} {
  const root = mkdtempSync(join(tmpdir(), 'occd-artifact-template-'))
  temporaryDirs.push(root)
  const templateDir = join(root, 'template')
  const cacheRoot = join(root, 'cache')
  const commonSha256: Record<string, string> = {}
  for (const filename of occdTemplateCommonFilenames(PAGE_ASSETS)) {
    write(join(templateDir, filename), commonContents(filename))
    commonSha256[filename] = sha256(join(templateDir, filename))
  }
  const targetDir = join(templateDir, OCCD_TEMPLATE_TARGETS_DIR, target)
  const files: Record<string, string> = {}
  for (const filename of occdTemplateTargetFilenames(target)) {
    write(join(targetDir, filename), targetContents(target, filename))
    files[filename] = sha256(join(targetDir, filename))
  }
  write(join(targetDir, 'agent-browser-linux-x64'), 'browser')
  write(
    join(templateDir, OCCD_TEMPLATE_MANIFEST_FILENAME),
    JSON.stringify({
      schemaVersion: 3,
      commonSha256,
      targets: {
        [target]: {
          files,
          browserName: 'agent-browser-linux-x64',
          browserSha256: sha256(join(targetDir, 'agent-browser-linux-x64'))
        }
      }
    })
  )
  return { templateDir, cacheRoot }
}

function rewriteManifest(
  templateDir: string,
  change: (manifest: z.infer<typeof ManifestSchema>) => void
): void {
  const manifestPath = join(templateDir, OCCD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
  change(manifest)
  write(manifestPath, JSON.stringify(manifest))
}

describe('assembleOCCdArtifact', () => {
  it('reuses the same version from cache after retention evicts other versions', async () => {
    const fixture = createTemplate()
    const first = await assembleOCCdArtifact({ ...fixture, target: TARGET })
    const entry = statSync(join(first, 'occd.js'))
    const older = [1, 2, 3].map((age) => {
      const dir = join(fixture.cacheRoot, TARGET, `0.0.${age}+old`)
      write(join(dir, 'occd.js'), 'old')
      const at = new Date(Date.now() - age * 60_000)
      utimesSync(dir, at, at)
      return dir
    })
    const removed = await pruneOCCdArtifactCache(fixture.cacheRoot, {
      inUseVersions: new Set([basename(first)])
    })

    expect(removed).toEqual([older[2]])
    const second = await assembleOCCdArtifact({ ...fixture, target: TARGET })
    expect(second).toBe(first)
    expect(statSync(join(second, 'occd.js')).ino).toBe(entry.ino)
  })

  it.skipIf(process.platform === 'win32')(
    'restores executable modes from a template copied without them',
    async () => {
      const target = 'darwin-arm64' as const
      const fixture = createTemplate(target)
      const executables = [
        occdRipgrepArtifact(target),
        'node_modules/node-pty/build/Release/spawn-helper'
      ]
      for (const filename of executables) {
        chmodSync(join(fixture.templateDir, OCCD_TEMPLATE_TARGETS_DIR, target, filename), 0o644)
      }
      const artifactDir = await assembleOCCdArtifact({ ...fixture, target })
      for (const filename of executables) {
        expect(statSync(join(artifactDir, filename)).mode & 0o777).toBe(0o755)
      }
    }
  )

  it('assembles the rung B compat slot against the compat runtime', async () => {
    const target = 'linux-x64-glibc217' as const
    const fixture = createTemplate(target)
    const artifactDir = await assembleOCCdArtifact({ ...fixture, target })

    expect(readFileSync(join(artifactDir, OCCD_NODE_RUNTIME_MARKER_FILENAME), 'utf8').trim()).toBe(
      NODE_RUNTIME_COMPAT_ASSETS[target].executableSha256
    )
    expect(
      readFileSync(join(artifactDir, 'node_modules/node-pty/build/Release/pty.node'), 'utf8')
    ).toBe(`${target}:node_modules/node-pty/build/Release/pty.node`)
    expect(await readOCCdArtifactIdentity(artifactDir)).toBe(
      readFileSync(join(artifactDir, OCCD_VERSION_FILENAME), 'utf8').trim()
    )
  })

  it('refuses a compat slot that names the default runtime', async () => {
    const target = 'linux-x64-glibc217' as const
    const fixture = createTemplate(target)
    const marker = join(
      fixture.templateDir,
      OCCD_TEMPLATE_TARGETS_DIR,
      target,
      OCCD_NODE_RUNTIME_MARKER_FILENAME
    )
    write(marker, `${NODE_RUNTIME_ASSETS['linux-x64-glibc'].executableSha256}\n`)
    rewriteManifest(fixture.templateDir, (manifest) => {
      const entry = manifest.targets[target]
      if (entry) {
        entry.files[OCCD_NODE_RUNTIME_MARKER_FILENAME] = sha256(marker)
      }
    })
    await expect(assembleOCCdArtifact({ ...fixture, target })).rejects.toThrow(
      'does not reference the pinned Node'
    )
  })

  it('assembles a complete content-addressed slot that references the pinned Node', async () => {
    const fixture = createTemplate()
    const artifactDir = await assembleOCCdArtifact({ ...fixture, target: TARGET })

    const version = readFileSync(join(artifactDir, OCCD_VERSION_FILENAME), 'utf8').trim()
    expect(version).toMatch(/^0\.1\.0\+[a-f0-9]{12}$/u)
    expect(await readOCCdArtifactIdentity(artifactDir)).toBe(version)
    write(join(artifactDir, 'occd.js'), 'changed-installed-bytes')
    expect(await readOCCdArtifactIdentity(artifactDir)).not.toBe(version)
    expect(artifactDir).toBe(join(fixture.cacheRoot, TARGET, version))
    expect(readFileSync(join(artifactDir, OCCD_SERVER_TARGET_FILENAME), 'utf8').trim()).toBe(
      TARGET
    )
    expect(readFileSync(join(artifactDir, OCCD_NODE_RUNTIME_MARKER_FILENAME), 'utf8').trim()).toBe(
      NODE_RUNTIME_ASSETS[TARGET].executableSha256
    )
    for (const filename of occdArtifactFilenames(TARGET, PAGE_ASSETS)) {
      expect(readFileSync(join(artifactDir, filename)).byteLength).toBeGreaterThan(0)
    }
    // Bun-era clients would require Bun and exit 78 if this marker were present.
    expect(() => readFileSync(join(artifactDir, OCCD_BUILD_TARGET_FILENAME))).toThrow()
    expect(readFileSync(join(artifactDir, 'agent-browser-linux-x64'), 'utf8')).toBe('browser')
  })

  it('rejects a packaged native file that does not match its manifest', async () => {
    const fixture = createTemplate()
    write(
      join(
        fixture.templateDir,
        OCCD_TEMPLATE_TARGETS_DIR,
        TARGET,
        'node_modules/node-pty/build/Release/pty.node'
      ),
      'corrupted'
    )

    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'node_modules/node-pty/build/Release/pty.node checksum mismatch'
    )
  })

  it('copies the page phones load into the slot, verified like every other file', async () => {
    const fixture = createTemplate()
    const artifactDir = await assembleOCCdArtifact({ ...fixture, target: TARGET })
    expect(readFileSync(join(artifactDir, 'out/mobile-web/index.html'), 'utf8')).toBe(
      'out/mobile-web/index.html'
    )
    expect(existsSync(join(artifactDir, OCCD_MOBILE_WEB_MANIFEST))).toBe(true)

    const corrupted = createTemplate()
    write(join(corrupted.templateDir, 'out/mobile-web/index.html'), 'corrupted')
    await expect(assembleOCCdArtifact({ ...corrupted, target: TARGET })).rejects.toThrow(
      'out/mobile-web/index.html checksum mismatch'
    )
  })

  it('refuses a template page asset name that escapes the slot', async () => {
    const fixture = createTemplate()
    rewriteManifest(fixture.templateDir, (manifest) => {
      manifest.commonSha256['out/mobile-web/../../escape.js'] = sha256(
        join(fixture.templateDir, 'out/mobile-web/index.html')
      )
    })
    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'unsafe page asset: out/mobile-web/../../escape.js'
    )
  })

  it('rejects a self-consistent target marker for a different native slot', async () => {
    const fixture = createTemplate()
    const targetPath = join(
      fixture.templateDir,
      OCCD_TEMPLATE_TARGETS_DIR,
      TARGET,
      OCCD_SERVER_TARGET_FILENAME
    )
    write(targetPath, 'linux-x64-musl\n')
    rewriteManifest(fixture.templateDir, (manifest) => {
      manifest.targets[TARGET]!.files[OCCD_SERVER_TARGET_FILENAME] = sha256(targetPath)
    })

    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'target identity does not match'
    )
  })

  it('rejects a self-consistent runtime reference to another Node', async () => {
    const fixture = createTemplate()
    const markerPath = join(
      fixture.templateDir,
      OCCD_TEMPLATE_TARGETS_DIR,
      TARGET,
      OCCD_NODE_RUNTIME_MARKER_FILENAME
    )
    write(markerPath, `${'0'.repeat(64)}\n`)
    rewriteManifest(fixture.templateDir, (manifest) => {
      manifest.targets[TARGET]!.files[OCCD_NODE_RUNTIME_MARKER_FILENAME] = sha256(markerPath)
    })

    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'does not reference the pinned Node'
    )
  })

  it('repairs corrupt artifacts beside the old entry and reuses the repair', async () => {
    const fixture = createTemplate()
    const first = await assembleOCCdArtifact({ ...fixture, target: TARGET })
    write(join(first, 'occd.js'), 'corrupted-cache-entry')

    const repaired = await assembleOCCdArtifact({ ...fixture, target: TARGET })
    expect(repaired).not.toBe(first)
    expect(readFileSync(join(repaired, 'occd.js'))).toEqual(
      readFileSync(join(fixture.templateDir, 'occd.js'))
    )
    expect(await assembleOCCdArtifact({ ...fixture, target: TARGET })).toBe(repaired)
    expect(readFileSync(join(first, 'occd.js'), 'utf8')).toBe('corrupted-cache-entry')
  })

  // Desktop templates omit drivers; the app's resources copy must still reach the slot (#33846).
  it("copies the app's own driver into the slot when the template references it", async () => {
    const fixture = createTemplate()
    renameSync(
      join(fixture.templateDir, OCCD_TEMPLATE_TARGETS_DIR, TARGET, 'agent-browser-linux-x64'),
      join(dirname(fixture.templateDir), 'agent-browser-linux-x64')
    )
    rewriteManifest(fixture.templateDir, (manifest) => {
      Object.assign(manifest.targets[TARGET]!, { packagedBrowser: true })
    })

    const artifactDir = await assembleOCCdArtifact({ ...fixture, target: TARGET })

    expect(readFileSync(join(artifactDir, 'agent-browser-linux-x64'), 'utf8')).toBe('browser')
  })

  it('rejects an optional browser without a matching manifest checksum', async () => {
    const fixture = createTemplate()
    rewriteManifest(fixture.templateDir, (manifest) => {
      delete manifest.targets[TARGET]?.browserSha256
    })

    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'browserName and browserSha256'
    )
  })

  it('rejects a browser named like a required slot file', async () => {
    const fixture = createTemplate()
    rewriteManifest(fixture.templateDir, (manifest) => {
      manifest.targets[TARGET]!.browserName = 'occd.js'
    })

    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'browser name collides with a slot file'
    )
  })

  it('rejects a manifest that omits a required common artifact checksum', async () => {
    const fixture = createTemplate()
    rewriteManifest(fixture.templateDir, (manifest) => {
      delete manifest.commonSha256['occd.js']
    })

    await expect(assembleOCCdArtifact({ ...fixture, target: TARGET })).rejects.toThrow(
      'manifest omits occd.js'
    )
  })
})

describe('assembleOCCdArtifact verification record', () => {
  // Move the clock beyond fixture writes so signatures count as settled.
  const later = (): number => Date.now() + 60_000
  const recordPath = (cacheRoot: string): string =>
    join(cacheRoot, TARGET, OCCD_ARTIFACT_VERIFICATION_RECORD_FILENAME)

  async function assembleUntilSlotRecorded(fixture: {
    templateDir: string
    cacheRoot: string
  }): Promise<string> {
    const first = await assembleOCCdArtifact({
      ...fixture,
      target: TARGET,
      now: later,
      trustVerificationRecord: true
    })
    expect(
      await assembleOCCdArtifact({
        ...fixture,
        target: TARGET,
        now: later,
        trustVerificationRecord: true
      })
    ).toBe(first)
    return first
  }

  it('neither reads nor writes a record unless the caller trusts it', async () => {
    const fixture = createTemplate()
    const slot = await assembleUntilSlotRecorded(fixture)
    const recorded = readFileSync(recordPath(fixture.cacheRoot), 'utf8')
    const before = fileReads.count
    expect(await assembleOCCdArtifact({ ...fixture, target: TARGET, now: later })).toBe(slot)
    expect(fileReads.count - before).toBe(
      (occdArtifactFilenames(TARGET, PAGE_ASSETS).length + 1) * 2
    )
    rmSync(recordPath(fixture.cacheRoot))
    await assembleOCCdArtifact({ ...fixture, target: TARGET, now: later })
    expect(existsSync(recordPath(fixture.cacheRoot))).toBe(false)
    expect(recorded.length).toBeGreaterThan(0)
  })

  it('records nothing while the files may still change under the same timestamps', async () => {
    const fixture = createTemplate()
    await assembleOCCdArtifact({ ...fixture, target: TARGET, trustVerificationRecord: true })
    expect(existsSync(recordPath(fixture.cacheRoot))).toBe(false)
  })

  it('reuses recorded digests without reading the template or the slot again', async () => {
    const fixture = createTemplate()
    const slot = await assembleUntilSlotRecorded(fixture)
    const before = fileReads.count
    expect(
      await assembleOCCdArtifact({
        ...fixture,
        target: TARGET,
        now: later,
        trustVerificationRecord: true
      })
    ).toBe(slot)
    expect(fileReads.count).toBe(before)
  })

  it('hashes the template once per launch when nothing is recorded', async () => {
    const fixture = createTemplate()
    const before = fileReads.count
    const slot = await assembleOCCdArtifact({ ...fixture, target: TARGET })
    const sources = occdArtifactFilenames(TARGET, PAGE_ASSETS).length + 1
    expect(fileReads.count - before).toBe(sources * 2)
    expect(slot).toContain(fixture.cacheRoot)
  })

  it('hashes again when a template file is rewritten in place at the same size', async () => {
    const fixture = createTemplate()
    await assembleUntilSlotRecorded(fixture)
    const templateEntry = join(fixture.templateDir, 'occd.js')
    writeFileSync(templateEntry, 'occd-ENTRY')

    await expect(
      assembleOCCdArtifact({
        ...fixture,
        target: TARGET,
        now: later,
        trustVerificationRecord: true
      })
    ).rejects.toThrow('occd template occd.js checksum mismatch')
  })

  it('hashes again when the manifest no longer lists the recorded digest', async () => {
    const fixture = createTemplate()
    await assembleUntilSlotRecorded(fixture)
    rewriteManifest(fixture.templateDir, (manifest) => {
      manifest.commonSha256['occd.js'] = 'f'.repeat(64)
    })

    await expect(
      assembleOCCdArtifact({
        ...fixture,
        target: TARGET,
        now: later,
        trustVerificationRecord: true
      })
    ).rejects.toThrow('occd template occd.js checksum mismatch')
  })

  it('repairs a recorded slot whose file was rewritten in place at the same size', async () => {
    const fixture = createTemplate()
    const slot = await assembleUntilSlotRecorded(fixture)
    writeFileSync(join(slot, 'occd.js'), 'occd-ENTRY')

    const repaired = await assembleOCCdArtifact({
      ...fixture,
      target: TARGET,
      now: later,
      trustVerificationRecord: true
    })
    expect(repaired).toBe(`${slot}.repair-1`)
    expect(readFileSync(join(repaired, 'occd.js'), 'utf8')).toBe('occd-entry')
  })

  it('ignores an unreadable record and hashes as before', async () => {
    const fixture = createTemplate()
    const slot = await assembleUntilSlotRecorded(fixture)
    writeFileSync(recordPath(fixture.cacheRoot), '{"version":1,')

    expect(
      await assembleOCCdArtifact({
        ...fixture,
        target: TARGET,
        now: later,
        trustVerificationRecord: true
      })
    ).toBe(slot)
  })
})

describe('materializeOCCdArtifact cancellation', () => {
  it('detaches a cancelled caller without cancelling the shared cache fill', async () => {
    const fixture = createTemplate()
    const first = new AbortController()
    const one = materializeOCCdArtifact(TARGET, { ...fixture, signal: first.signal })
    const two = materializeOCCdArtifact(TARGET, fixture)
    first.abort(new Error('first cancelled'))
    await expect(one).rejects.toThrow('first cancelled')
    const artifact = await two
    expect(readFileSync(join(artifact, 'occd.js'), 'utf8')).toBe('occd-entry')
  })

  it('refuses an already cancelled request before reading artifacts', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(materializeOCCdArtifact(TARGET, { signal: controller.signal })).rejects.toThrow(
      'cancelled'
    )
  })
})

describe('packaged template lookup', () => {
  const originalResourcesPath = process.resourcesPath
  const originalTemplatePath = process.env.OCC_OCCD_TEMPLATE_PATH
  let previousEnvironment: AppEnvironment | null = null

  afterEach(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true
    })
    if (originalTemplatePath === undefined) {
      delete process.env.OCC_OCCD_TEMPLATE_PATH
    } else {
      process.env.OCC_OCCD_TEMPLATE_PATH = originalTemplatePath
    }
    if (previousEnvironment) {
      setAppEnvironment(previousEnvironment)
    }
  })

  function installPackagedApp(): { resourcesDir: string; userData: string } {
    const fixture = createTemplate()
    const root = dirname(fixture.templateDir)
    const resourcesDir = join(root, 'Resources')
    mkdirSync(resourcesDir)
    renameSync(fixture.templateDir, join(resourcesDir, 'occd-template'))
    const userData = join(root, 'userData')
    delete process.env.OCC_OCCD_TEMPLATE_PATH
    Object.defineProperty(process, 'resourcesPath', {
      value: resourcesDir,
      configurable: true,
      writable: true
    })
    previousEnvironment = hasAppEnvironment() ? getAppEnvironment() : null
    setAppEnvironment({
      getPath: () => userData,
      getAppPath: () => join(resourcesDir, 'app.asar'),
      getVersion: () => '0.0.0-test',
      isPackaged: () => true,
      onWillQuit: () => {},
      exit: () => {},
      getAppMetrics: () => []
    })
    return { resourcesDir, userData }
  }

  it('materializes from Resources/occd-template into userData with no explicit paths', async () => {
    const { resourcesDir, userData } = installPackagedApp()

    expect(getOCCdTemplateCandidates()[0]).toBe(join(resourcesDir, 'occd-template'))
    const artifact = await materializeOCCdArtifact(TARGET)
    expect(dirname(dirname(artifact))).toBe(join(userData, 'occd-artifacts'))
    expect(readFileSync(join(artifact, 'occd.js'), 'utf8')).toBe('occd-entry')
  })

  it('reports a build that shipped no template, which relays treat as a legacy fallback', async () => {
    const { resourcesDir } = installPackagedApp()
    rmSync(join(resourcesDir, 'occd-template'), { recursive: true })

    await expect(materializeOCCdArtifact(TARGET)).rejects.toThrow(
      'The packaged occd deployment template is missing'
    )
  })
})
