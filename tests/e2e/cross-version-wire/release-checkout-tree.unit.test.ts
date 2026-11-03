import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as currentProcessHost from '@occ/process-host'
import { importReleaseCheckoutModule } from './release-checkout'
import { extractReleaseCheckoutTree } from './release-checkout-tree'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function temporaryDirectory(prefix: string): string {
  // Why realpath: vite reports module urls through macOS's /var -> /private/var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temporaryRoots.push(root)
  return root
}

// Every fixed archive path must exist in a release, or `git archive` refuses the pathspec.
const RELEASE_SKELETON: Record<string, string> = Object.fromEntries(
  [
    'src/main/placeholder.ts',
    'src/shared/placeholder.ts',
    'src/preload/placeholder.ts',
    'src/renderer/src/placeholder.ts',
    'src/types/placeholder.ts',
    'mobile/src/worktree/agent-row-display.ts'
  ].map((path) => [path, 'export {}\n'])
)

function commitRelease(files: Record<string, string>): { repo: string; commit: string } {
  const repo = temporaryDirectory('occ-cross-version-release-repo-')
  for (const [path, source] of Object.entries({ ...RELEASE_SKELETON, ...files })) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), source)
  }
  const git = (args: string[]): string =>
    execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
      cwd: repo,
      encoding: 'utf8'
    }).trim()
  git(['init', '--quiet'])
  git(['add', '--all'])
  git([
    '-c',
    'user.name=release',
    '-c',
    'user.email=release@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--message',
    'release'
  ])
  writeFileSync(join(repo, 'package.json'), '{ "dependencies": {} }\n')
  return { repo, commit: git(['rev-parse', 'HEAD']) }
}

const RELEASE_PROCESS_HOST = {
  'src/packages/process-host/package.json': JSON.stringify({
    name: '@occ/process-host',
    type: 'commonjs',
    exports: {
      '.': { 'occ-source': './src/run-process.ts', default: './dist/run-process.js' },
      './process-spec': {
        'occ-source': './src/process-spec.ts',
        default: './dist/process-spec.js'
      }
    }
  }),
  'src/packages/process-host/src/run-process.ts': [
    "import { describeSpec } from './process-spec'",
    "export const runProcess = () => 'release runProcess'",
    'export const releaseOnlyExport = describeSpec',
    ''
  ].join('\n'),
  'src/packages/process-host/src/process-spec.ts':
    "export const describeSpec = () => 'release process-spec'\n",
  'src/packages/process-host/src/run-process.test.ts': 'throw new Error("stale spec")\n',
  'src/packages/release-tool/package.json': JSON.stringify({
    name: '@occ/release-tool',
    type: 'module',
    exports: {
      '.': { 'occ-source': './src/index.mjs', default: './dist/index.js' },
      './private': { default: './dist/private.js' }
    }
  }),
  'src/packages/release-tool/src/index.mjs':
    "import { runProcess } from '@occ/process-host'\nexport const tool = () => `tool:${runProcess()}`\n",
  'src/packages/release-tool/src/index.test.mjs': 'throw new Error("stale spec")\n'
}

describe('release checkout workspace packages', () => {
  it('loads the release workspace package rather than the current one', async () => {
    expect('releaseOnlyExport' in currentProcessHost).toBe(false)
    const { repo, commit } = commitRelease({
      'pnpm-workspace.yaml': "packages:\n  - src/packages/*\n  - '!src/packages/ignored'\n",
      ...RELEASE_PROCESS_HOST,
      'src/main/consumer.ts': [
        "import { runProcess, releaseOnlyExport } from '@occ/process-host'",
        "import * as spec from '@occ/process-host/process-spec'",
        'export { describeSpec as reexported } from "@occ/process-host/process-spec"',
        'export const staticRun = runProcess()',
        'export const releaseOnly = releaseOnlyExport()',
        'export const specValue = spec.describeSpec()',
        "export const lazyRun = async () => (await import('@occ/process-host')).runProcess()",
        ''
      ].join('\n'),
      'src/main/esm-consumer.mjs': [
        "import { describeSpec } from '@occ/process-host/process-spec'",
        "import { tool } from '@occ/release-tool'",
        'export const esm = `${describeSpec()}|${tool()}`',
        ''
      ].join('\n'),
      'src/main/commonjs-consumer.cjs':
        "module.exports = () => require('@occ/process-host/process-spec')\n",
      'src/renderer/src/lib/view.ts': [
        "import { label } from '@/lib/label'",
        "export const view = async () => `${label}:${(await import('@occ/process-host')).runProcess()}`",
        ''
      ].join('\n'),
      'src/renderer/src/lib/label.ts': "export const label = 'renderer'\n"
    })
    const staging = temporaryDirectory('occ-cross-version-release-staging-')

    await extractReleaseCheckoutTree(repo, staging, commit)
    const checkout = { ref: 'v0.0.0-synthetic', commit, label: 'v0.0.0-synthetic', root: staging }
    const consumer = await importReleaseCheckoutModule(checkout, '/src/main/consumer.ts')
    const view = await importReleaseCheckoutModule(checkout, '/src/renderer/src/lib/view.ts')
    const esm = await importReleaseCheckoutModule(checkout, '/src/main/esm-consumer.mjs')
    const call = async (module: Record<string, unknown>, name: string): Promise<unknown> => {
      const exported = module[name]
      if (typeof exported !== 'function') {
        throw new Error(`synthetic release has no ${name} export`)
      }
      return exported()
    }

    expect(consumer.staticRun).toBe('release runProcess')
    expect(consumer.releaseOnly).toBe('release process-spec')
    expect(consumer.specValue).toBe('release process-spec')
    expect(await call(consumer, 'reexported')).toBe('release process-spec')
    expect(await call(consumer, 'lazyRun')).toBe('release runProcess')
    expect(await call(view, 'view')).toBe('renderer:release runProcess')
    expect(esm.esm).toBe('release process-spec|tool:release runProcess')
    expect(readFileSync(join(staging, 'src/main/commonjs-consumer.cjs'), 'utf8')).toContain(
      "require('../packages/process-host/src/process-spec.ts')"
    )
    expect(existsSync(join(staging, 'src/packages/process-host/src/run-process.test.ts'))).toBe(
      false
    )
    expect(existsSync(join(staging, 'src/packages/release-tool/src/index.test.mjs'))).toBe(false)
    expect(existsSync(join(staging, 'node_modules'))).toBe(false)
  })

  it.each(['@occ/process-host/internal', '@occ/release-tool/private', '@occ/not-in-release'])(
    'fails extraction rather than loading the current tree for %s',
    async (specifier) => {
      const { repo, commit } = commitRelease({
        'pnpm-workspace.yaml': 'packages:\n  - src/packages/*\n',
        ...RELEASE_PROCESS_HOST,
        'src/main/private.ts': `import { x } from '${specifier}'\nexport { x }\n`
      })
      const staging = temporaryDirectory('occ-cross-version-release-staging-')

      const failure = await extractReleaseCheckoutTree(repo, staging, commit).then(
        () => null,
        (error: unknown) => String(error)
      )

      expect(failure).toMatch(/src[/\\]main[/\\]private\.ts: /)
      expect(failure).toContain(`No public occ-source export for ${specifier}`)
    }
  )
})
