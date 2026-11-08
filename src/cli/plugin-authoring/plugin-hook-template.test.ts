import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPluginFromTemplate } from './plugin-create'
import { findPluginTestFiles, runPluginTests } from './plugin-test-runner'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function hookPlugin(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'occ-hook-template-')))
  roots.push(root)
  const dir = join(root, 'guard')
  await createPluginFromTemplate({ dir, template: 'hook' })
  return dir
}

describe('occ plugin create --template hook', () => {
  it(
    "passes its own worker test under `occ plugin test` on OCC's runtime",
    async () => {
      const dir = await hookPlugin()
      const files = await findPluginTestFiles(dir)
      expect(files).toEqual(['src/worker.test.ts'])
      const occ = {
        program: process.execPath,
        env: { ELECTRON_RUN_AS_NODE: '1' },
        source: 'occ' as const,
        version: process.version
      }
      expect(await runPluginTests({ dir, files, quietStdout: true, node: occ })).toEqual({
        runner: 'node',
        code: 0,
        node: 'occ'
      })
    },
    // Starts its own Node process and transpiles the plugin.
    60_000
  )
})
