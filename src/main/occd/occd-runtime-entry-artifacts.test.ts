// Child entries referenced by filename must ship beside occd.js; bundling alone cannot include them.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { runProcessSync } from '@occ/process-host'
import { occdArtifactFilenames } from '../../shared/occd-artifacts'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const RUNTIME_ENTRY_FILENAME = /[A-Za-z0-9_.-]+-(?:entry|worker)\.c?js/g
// Known gaps must disappear as entries ship or references are removed; additions are not exemptions.
const KNOWN_UNSHIPPED_ENTRIES = new Set(['wsl-transcript-fs-process-entry.js'])
const directory = mkdtempSync(join(tmpdir(), 'occd-runtime-entries-'))

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function buildOCCdBundles(): string[] {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/occd-entry-build.mjs')).href
  const script = `
    import { build } from 'esbuild'
    import { join } from 'node:path'
    import * as entries from ${JSON.stringify(builder)}
    const out = ${JSON.stringify(directory)}
    await entries.buildOCCdEntry(join(out, 'occd.js'))
    await Promise.all(Object.values(entries.OCCD_CHILD_ENTRY_POINTS).map((entry) => build({
      entryPoints: [entry], bundle: true, platform: 'node', target: entries.OCCD_SERVER_BUILD_TARGET, format: 'cjs',
      outfile: join(out, entries.occdChildOutputFilename(entry)),
      external: entries.OCCD_EXTERNAL_MODULES, plugins: [entries.externalNativeAddons],
      logLevel: 'error'
    })))`
  const built = runProcessSync({
    program: process.execPath,
    args: ['--input-type=module', '-e', script],
    cwd: REPO_ROOT,
    env: { ...process.env, OCC_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 120_000
  })
  expect(built.code, built.stderr.slice(0, 2_000)).toBe(0)
  return readdirSync(directory).map((file) => readFileSync(join(directory, file), 'utf8'))
}

it('ships every worker and child entry occd loads at runtime', () => {
  const named = new Set(
    buildOCCdBundles().flatMap((text) => text.match(RUNTIME_ENTRY_FILENAME) ?? [])
  )
  const shipped = new Set(occdArtifactFilenames('linux-x64-glibc', []))
  const missing = [...named].filter(
    (filename) => !shipped.has(filename) && !KNOWN_UNSHIPPED_ENTRIES.has(filename)
  )
  expect(missing, 'add these to OCCD_ARTIFACTS and build them in build-occd.mjs').toEqual([])
  for (const filename of KNOWN_UNSHIPPED_ENTRIES) {
    expect(named.has(filename) && !shipped.has(filename), filename).toBe(true)
  }
})

it('ships every child entry build-occd.mjs builds', async () => {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/occd-entry-build.mjs')).href
  const entries = await import(builder)
  const shipped = new Set(occdArtifactFilenames('linux-x64-glibc', []))
  const built = Object.values<string>(entries.OCCD_CHILD_ENTRY_POINTS).map((entry) =>
    entries.occdChildOutputFilename(entry)
  )
  expect(built).toContain('session-scanner-service-entry.js')
  expect(built.filter((filename) => !shipped.has(filename))).toEqual([])
})
