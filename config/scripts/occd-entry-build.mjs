import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { OCCD_SERVER_ENTRY_FILENAME } from '../../src/shared/occd-artifacts.ts'

const root = join(import.meta.dirname, '..', '..')
const { turnedOnDarkBuildDefines } = createRequire(import.meta.url)('../dark-build-switches.cjs')

export const OCCD_ENTRY_POINT = 'src/main/occd/main.ts'
export const OCCD_LAUNCHER_ENTRY_POINT = 'src/main/occd/launcher.ts'
export const OCCD_SERVER_BUILD_TARGET = 'node24'
// Host entry points must load before OCC selects its bundled runtime.
const OCCD_COMPAT_BUILD_TARGET = 'node18'
export const OCCD_CHILD_ENTRY_POINTS = {
  watcher: 'src/main/ipc/filesystem/watcher-process/parcel-watcher-process-entry.ts',
  daemon: 'src/main/daemon/daemon-entry.ts',
  writer: 'src/main/persistence/profile-state/profile-state-writer-worker-entry.ts',
  backup: 'src/main/persistence/profile-state/profile-state-backup-worker-entry.ts',
  foreignSqliteReader: 'src/main/foreign-sqlite-readers/foreign-sqlite-reader-entry.ts',
  portScanCommandWorker: 'src/main/ports/port-scan-command-worker-entry.ts',
  commandPathDirectoryWorker: 'src/main/ipc/command-path-directory-worker-entry.ts',
  sessionScanner: 'src/main/ai-vault/session-scanner-service-entry.ts',
  workerThreadChildProcess:
    'src/main/worker-thread-child-process/worker-thread-child-process-entry.ts',
  claudeProfileSetup: 'src/main/claude-accounts/claude-profile-setup-worker-entry.ts',
  sttWorker: 'src/main/speech/stt-worker.ts',
  computerSidecar: 'src/main/computer/computer-sidecar.ts'
}

/** Each child ships flat beside occd.js under its source basename; the runtime resolvers look there. */
export function occdChildOutputFilename(entryPoint) {
  return basename(entryPoint).replace(/\.ts$/, '.js')
}

export const OCCD_EXTERNAL_MODULES = ['electron', 'node-pty', '@parcel/watcher', 'fsevents']

// Bundled ESM resolves from the deployed bundle, like CommonJS __filename.
export const OCCD_COMMONJS_MODULE_OPTIONS = {
  banner: {
    js: 'var __occdModuleUrl = require("node:url").pathToFileURL(__filename).href;'
  },
  define: {
    'import.meta.url': '__occdModuleUrl',
    // Why only when on: an undeclared switch already reads as off, so other builds keep their bytes.
    ...turnedOnDarkBuildDefines()
  },
  logOverride: { 'empty-import-meta': 'error' }
}

// Native binaries are staged separately from every JavaScript entry.
export const externalNativeAddons = {
  name: 'external-native-addons',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }))
  }
}

// The UMD build's relative dynamic requires cannot be bundled.
const jsoncParserEsm = {
  name: 'jsonc-parser-esm',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^jsonc-parser$/ }, () => ({
      path: join(root, 'node_modules', 'jsonc-parser', 'lib', 'esm', 'main.js')
    }))
  }
}

// Every occd bundle (server, children, CLI) must share these, or one ships a UMD build that cannot load (#33592).
export const OCCD_BUNDLE_PLUGINS = [jsoncParserEsm, externalNativeAddons]

// One non-ASCII character makes V8 store the ~11MB bundle as ~21MB two-byte text; esbuild escapes strings but leaves regex/tagged-template literals.
export function findNonAsciiSource(source) {
  let index = 0
  while (index < source.length && source.charCodeAt(index) < 0x80) {
    index++
  }
  if (index === source.length) {
    return null
  }
  const line = source.slice(0, index).split('\n').length
  return { offset: index, line, excerpt: source.slice(Math.max(0, index - 60), index + 20) }
}

const LEGAL_COMMENT_TAIL = '\n/*! Bundled license information:'

/** Escapes the license text esbuild gathers at the end; it is a comment, so no value changes. */
export function escapeLegalCommentTail(source) {
  const start = source.lastIndexOf(LEGAL_COMMENT_TAIL)
  if (start === -1) {
    return source
  }
  let tail = ''
  for (const char of source.slice(start)) {
    const code = char.codePointAt(0)
    tail += code < 0x80 ? char : `\\u{${code.toString(16)}}`
  }
  return source.slice(0, start) + tail
}

/** The module holding `offset` in an unminified build, read from esbuild's `// path` markers. */
export function moduleAtOffset(source, offset) {
  let found = null
  for (const match of source.matchAll(/\n {0,2}\/\/ ((?:src|node_modules|\.\.)\/[^\n]+)\n/g)) {
    if (match.index > offset) {
      break
    }
    found = match[1]
  }
  return found
}

async function nonAsciiModule(outfile) {
  const unminified = `${outfile}.unminified.js`
  try {
    await buildOCCdEntryBundle(unminified, false)
    const source = readFileSync(unminified, 'utf8')
    const nonAscii = findNonAsciiSource(source)
    return nonAscii ? moduleAtOffset(source, nonAscii.offset) : null
  } finally {
    rmSync(unminified, { force: true })
  }
}

export async function buildOCCdEntry(outfile) {
  const result = await buildOCCdEntryBundle(outfile, true)
  const source = escapeLegalCommentTail(readFileSync(outfile, 'utf8'))
  writeFileSync(outfile, source)
  const nonAscii = findNonAsciiSource(source)
  if (nonAscii) {
    const module = await nonAsciiModule(outfile)
    throw new Error(
      `occd server bundle has a non-ASCII character at offset ${nonAscii.offset} ` +
        `(line ${nonAscii.line}${module ? `, from ${module}` : ''}): ...${nonAscii.excerpt}... ` +
        'Write it as a \\uXXXX escape in the source regex or String.raw template.'
    )
  }
  return result
}

function buildOCCdEntryBundle(outfile, minify) {
  return build({
    ...OCCD_COMMONJS_MODULE_OPTIONS,
    entryPoints: [join(root, OCCD_ENTRY_POINT)],
    bundle: true,
    platform: 'node',
    target: OCCD_SERVER_BUILD_TARGET,
    format: 'cjs',
    outfile,
    external: OCCD_EXTERNAL_MODULES,
    plugins: OCCD_BUNDLE_PLUGINS,
    metafile: true,
    minify,
    // Licenses stay in the bundle as a trailing comment, which `escapeLegalCommentTail` keeps ASCII.
    legalComments: 'eof',
    sourcemap: false,
    define: {
      ...OCCD_COMMONJS_MODULE_OPTIONS.define,
      'process.env.NODE_ENV': '"production"'
    },
    logLevel: 'error'
  })
}

export function buildOCCdCli(outfile) {
  return build({
    entryPoints: [join(root, 'src/cli/index.ts')],
    bundle: true,
    platform: 'node',
    target: OCCD_COMPAT_BUILD_TARGET,
    format: 'cjs',
    outfile,
    plugins: OCCD_BUNDLE_PLUGINS,
    metafile: true,
    minify: true,
    sourcemap: false,
    logLevel: 'error'
  })
}

export function buildOCCdLauncher(outfile) {
  const serverSha256 = createHash('sha256')
    .update(readFileSync(join(dirname(outfile), OCCD_SERVER_ENTRY_FILENAME)))
    .digest('hex')
  return build({
    ...OCCD_COMMONJS_MODULE_OPTIONS,
    entryPoints: [join(root, OCCD_LAUNCHER_ENTRY_POINT)],
    bundle: true,
    platform: 'node',
    target: OCCD_COMPAT_BUILD_TARGET,
    format: 'cjs',
    outfile,
    metafile: true,
    minify: true,
    sourcemap: false,
    define: {
      ...OCCD_COMMONJS_MODULE_OPTIONS.define,
      OCCD_SERVER_SHA256: JSON.stringify(serverSha256)
    },
    logLevel: 'error'
  })
}
