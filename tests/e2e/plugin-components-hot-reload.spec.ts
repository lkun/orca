/**
 * Invariant: saving a dev components panel hot reloads it. Keyed memory atoms survive the reload
 * (unless their `version` changes), a "Reloaded" mark shows, and a save that does not load keeps
 * the last good tree with an inline error naming file:line:column until the next save fixes it.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'
import { ISOLATED_FRAMES_E2E } from './helpers/plugin-frame-guest'

test.use(ISOLATED_FRAMES_E2E)

const TITLE = 'Hot Reload'

function panelSource(label: string, draftOptions = ''): string {
  return [
    "import { atom, Heading, Input, read, set, Stack, Text } from 'occ'",
    '',
    `const draft = atom('draft', ''${draftOptions})`,
    '',
    'export default function Panel() {',
    '  return (',
    '    <Stack>',
    `      <Heading>Panel ${label}</Heading>`,
    '      <Input label="Draft" placeholder="Draft" value={read(draft)} onChange={(v) => set(draft, v)} />',
    "      <Text>Draft: {read(draft) || '(empty)'}</Text>",
    '    </Stack>',
    '  )',
    '}',
    ''
  ].join('\n')
}

async function openPanel(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = window.__store?.getState()
    if (store && !store.rightSidebarOpen) {
      store.toggleRightSidebar()
    }
    await window.api.plugins.refresh()
  })
  const button = page.getByRole('button', { name: TITLE })
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()
}

test('a dev components panel hot reloads with its memory atoms and survives a broken save', async ({
  occPage
}) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'occ-components-hot-reload-'))
  const pluginRoot = join(tempRoot, 'hot-reload')
  const panelFile = join(pluginRoot, 'src', 'panel.tsx')
  try {
    await mkdir(join(pluginRoot, 'src'), { recursive: true })
    await writeFile(
      join(pluginRoot, 'occ-plugin.json'),
      JSON.stringify({
        manifestVersion: 2,
        execution: 'sandboxed-ui',
        id: 'hot-reload',
        name: TITLE,
        version: '1.0.0',
        engines: { occ: '>=1.4.246' },
        pluginApi: 1,
        contributes: {
          panels: [{ id: 'main', title: TITLE, entry: 'src/panel.tsx', ui: 'components' }]
        }
      })
    )
    await writeFile(panelFile, panelSource('v1'))
    await enableDevPlugins(occPage, [pluginRoot])
    await openPanel(occPage)
    await expect(occPage.getByRole('heading', { name: 'Panel v1' })).toBeVisible({
      timeout: 15_000
    })

    // Filling is idempotent, so a retry after the dev watcher's own first remount stays exact.
    await expect(async () => {
      await occPage.getByPlaceholder('Draft').fill('kept across saves')
      await expect(occPage.getByText('Draft: kept across saves')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })

    await writeFile(panelFile, panelSource('v2'))
    await expect(occPage.getByRole('heading', { name: 'Panel v2' })).toBeVisible({
      timeout: 15_000
    })
    await expect(occPage.getByText('Draft: kept across saves')).toBeVisible()
    await expect(occPage.getByText('Reloaded', { exact: true })).toBeVisible()

    // A save that does not transpile: the v2 tree stays, with the error located in the source.
    await writeFile(panelFile, "import { atom } from 'occ'\n\nconst label = 'broken'\nconst = 1\n")
    const loadError = occPage.getByRole('alert').filter({ hasText: 'failed to load' })
    await expect(loadError).toContainText('src/panel.tsx:4:7: Unexpected token', {
      timeout: 15_000
    })
    await expect(occPage.getByRole('heading', { name: 'Panel v2' })).toBeVisible()
    await expect(occPage.getByText('Draft: kept across saves')).toBeVisible()

    // A throw is located at the source column (as `occ plugin check` reports), not the
    // type-stripped one Chromium's stack names.
    await writeFile(
      panelFile,
      "import { atom } from 'occ'\n\nconst n: number = Number('1'); if (n) throw new Error('boom')\n"
    )
    await expect(loadError).toContainText('src/panel.tsx:3:45: boom', { timeout: 15_000 })

    await writeFile(panelFile, panelSource('v3'))
    await expect(occPage.getByRole('heading', { name: 'Panel v3' })).toBeVisible({
      timeout: 15_000
    })
    await expect(loadError).toHaveCount(0)
    await expect(occPage.getByText('Draft: kept across saves')).toBeVisible()

    // A new `version` means a new shape: that atom starts over instead of taking the old value.
    await writeFile(panelFile, panelSource('v4', ', { version: 2 }'))
    await expect(occPage.getByRole('heading', { name: 'Panel v4' })).toBeVisible({
      timeout: 15_000
    })
    await expect(occPage.getByText('Draft: (empty)')).toBeVisible()
  } finally {
    await disablePluginSystem(occPage).catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
