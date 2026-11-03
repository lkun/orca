import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  pluginFolderWantsTypes,
  readOCCAuthorTypings,
  readOCCPluginTypings,
  writePluginTypeFiles
} from './plugin-type-files'
import { createPluginFromTemplate } from './plugin-create'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'occ-plugin-types-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('occ plugin types', () => {
  it('copies OCC typings and a tsconfig to extend into .occ/types, which ignores itself', async () => {
    const dir = await tempRoot()
    const files = await writePluginTypeFiles(dir)
    expect(files).toEqual([
      '.occ/.gitignore',
      '.occ/types/occ/index.d.ts',
      '.occ/types/occ-host/index.d.ts',
      '.occ/types/occ-frame/index.d.ts',
      '.occ/types/occ-worker/index.d.ts',
      '.occ/types/occ-services/index.d.ts',
      '.occ/types/occ-testing/index.d.ts',
      '.occ/types/tsconfig.json'
    ])
    const read = (folder: string) =>
      readFile(join(dir, '.occ', 'types', folder, 'index.d.ts'), 'utf8')
    const sources = await readOCCAuthorTypings()
    for (const [folder, text] of Object.entries(sources)) {
      expect(await read(folder)).toContain(text)
    }
    expect(sources.occ).toBe(await readOCCPluginTypings())
    expect(await read('occ')).toContain("declare module 'occ'")
    expect(await read('occ-host')).toContain("declare module 'occ/host'")
    expect(await read('occ-frame')).toContain('var occ: OCCFrameApi')
    expect(await read('occ-worker')).toContain("declare module 'occ/worker'")
    expect(await read('occ-testing')).toContain("declare module 'occ/testing'")
    expect(await read('occ-services')).toContain('export interface PluginRequests {}')
    const tsconfig = JSON.parse(
      await readFile(join(dir, '.occ', 'types', 'tsconfig.json'), 'utf8')
    )
    expect(tsconfig.compilerOptions).toMatchObject({
      jsxImportSource: 'occ',
      typeRoots: ['.'],
      types: ['occ', 'occ-host', 'occ-frame', 'occ-worker', 'occ-services', 'occ-testing']
    })
    expect(await readFile(join(dir, '.occ', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('refreshes on dev load only for folders that use TypeScript or components panels', async () => {
    const root = await tempRoot()
    const html = join(root, 'html-panel')
    await createPluginFromTemplate({ dir: html, template: 'panel' })
    expect(await pluginFolderWantsTypes(html)).toBe(false)
    const tsx = join(root, 'tsx-panel')
    await createPluginFromTemplate({ dir: tsx, template: 'components' })
    await rm(join(tsx, '.occ'), { recursive: true })
    expect(await pluginFolderWantsTypes(tsx)).toBe(true)
    const configured = join(root, 'configured')
    await mkdir(configured)
    await writeFile(join(configured, 'tsconfig.json'), '{"extends":"./.occ/types/tsconfig.json"}')
    expect(await pluginFolderWantsTypes(configured)).toBe(true)
  })
})
