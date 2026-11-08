import { build } from 'esbuild'
import { join } from 'node:path'
import { OCCD_LINEAR_SDK_ENTRY } from '../../../../src/shared/occd-artifacts.ts'
import { OCCD_SERVER_BUILD_TARGET } from './occd-entry-build.mjs'

// Bundle @linear/sdk into one CJS file for lazy require: copying would expose chunk names that change each release.
export async function stageOCCdLinearSdk(root, outputDir) {
  await build({
    stdin: {
      contents: "module.exports = require('@linear/sdk')",
      resolveDir: root,
      sourcefile: 'occd-linear-sdk-entry.js'
    },
    bundle: true,
    platform: 'node',
    target: OCCD_SERVER_BUILD_TARGET,
    format: 'cjs',
    outfile: join(outputDir, OCCD_LINEAR_SDK_ENTRY),
    minify: true,
    sourcemap: false,
    logLevel: 'error'
  })
}
