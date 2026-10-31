import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OCCD_MOBILE_WEB_MANIFEST,
  OCCD_NODE_RUNTIME_MARKER_FILENAME,
  OCCD_SERVER_TARGET_FILENAME,
  occdArtifactFilenames,
  occdRipgrepArtifact
} from '../../src/shared/occd-artifacts.ts'
import { SERVER_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { occdAgentBrowserNativeName } from '../../src/shared/occd-agent-browser-name.ts'
import { readOCCdArtifactIdentity } from '../../src/main/occd/occd-artifact-identity.ts'
import { computeOCCdFullVersion } from './occd-artifact-version.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const PAGE_ASSET = 'out/mobile-web/index.html'
const PAGE_MANIFEST = JSON.stringify({ assets: [{ path: 'index.html' }] })

function createArtifactDirectory(target = 'linux-x64-glibc') {
  const directory = mkdtempSync(join(tmpdir(), 'occd-version-'))
  directories.push(directory)
  for (const filename of occdArtifactFilenames(target, [PAGE_ASSET])) {
    const path = join(directory, filename)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, filename === OCCD_MOBILE_WEB_MANIFEST ? PAGE_MANIFEST : filename)
  }
  writeFileSync(join(directory, OCCD_SERVER_TARGET_FILENAME), `${target}\n`)
  return directory
}

describe('standalone runtime version', () => {
  it('changes when a shipped search binary changes and rejects a missing binary', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeOCCdFullVersion(dir, { target })
    const binary = join(dir, occdRipgrepArtifact(target))
    writeFileSync(binary, 'updated binary')
    expect(computeOCCdFullVersion(dir, { target })).not.toBe(before)
    rmSync(binary)
    expect(() => computeOCCdFullVersion(dir, { target })).toThrow(occdRipgrepArtifact(target))
  })

  it('changes when a page asset changes and rejects a missing one', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeOCCdFullVersion(dir, { target })
    writeFileSync(join(dir, PAGE_ASSET), 'updated page')
    expect(computeOCCdFullVersion(dir, { target })).not.toBe(before)
    rmSync(join(dir, PAGE_ASSET))
    expect(() => computeOCCdFullVersion(dir, { target })).toThrow(PAGE_ASSET)
  })

  it('keys the version on the referenced runtime digest rather than its bytes', () => {
    const target = 'darwin-arm64'
    const dir = createArtifactDirectory(target)
    writeFileSync(join(dir, OCCD_NODE_RUNTIME_MARKER_FILENAME), `${'a'.repeat(64)}\n`)
    const before = computeOCCdFullVersion(dir, { target })
    writeFileSync(join(dir, OCCD_NODE_RUNTIME_MARKER_FILENAME), `${'b'.repeat(64)}\n`)
    expect(computeOCCdFullVersion(dir, { target })).not.toBe(before)
  })

  it.each(SERVER_TARGETS)(
    'matches the installed %s identity with and without its optional browser',
    async (target) => {
      const dir = createArtifactDirectory(target)
      const [platform, arch] = target.split('-')
      const agentBrowserFilename = occdAgentBrowserNativeName(
        platform,
        arch,
        target.endsWith('-musl') ? 'musl' : 'glibc'
      )
      const options = { target, agentBrowserFilename }
      const withoutBrowser = computeOCCdFullVersion(dir, options)
      expect(withoutBrowser).toBe(await readOCCdArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'browser')
      const withBrowser = computeOCCdFullVersion(dir, options)
      expect(withBrowser).not.toBe(withoutBrowser)
      expect(withBrowser).toBe(await readOCCdArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'updated-browser')
      expect(computeOCCdFullVersion(dir, options)).not.toBe(withBrowser)
      expect(computeOCCdFullVersion(dir, options)).toBe(await readOCCdArtifactIdentity(dir))
    }
  )
})
