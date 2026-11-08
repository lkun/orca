/**
 * Invariant: two plugins that share a name, and themes that share a name, are told apart by the
 * OCC-derived publisher in the theme picker and the plugin list.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'

async function writeCatppuccinPlugin(root: string, publisher: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, 'occ-plugin.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: 'catppuccin',
      publisher,
      name: 'Catppuccin for OCC',
      version: '1.0.0',
      engines: { occ: '>=1.0.0' },
      pluginApi: 1,
      contributes: { themes: [{ id: 'mocha', title: 'Catppuccin Mocha', path: 'app.json' }] }
    })
  )
  await writeFile(
    join(root, 'app.json'),
    JSON.stringify({
      base: 'dark',
      tokens: { '--background': '#1e1e2e', '--foreground': '#cdd6f4' }
    })
  )
}

async function openSettingsPane(page: Page, pane: 'appearance' | 'plugins'): Promise<void> {
  await page.evaluate((target) => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: target, repoId: null })
    state?.openSettingsPage()
  }, pane)
  await expect(page.locator(`[data-settings-section="${pane}"]`)).toBeVisible()
}

test('plugins and themes sharing a name show their publishers', async ({ occPage }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'occ-name-clash-'))
  const proofDir = process.env.OCC_NAME_CLASH_PROOF_DIR
  try {
    await writeCatppuccinPlugin(join(root, 'acme'), 'acme')
    await writeCatppuccinPlugin(join(root, 'vale-c'), 'vale-c')
    await enableDevPlugins(occPage, [join(root, 'acme'), join(root, 'vale-c')])

    await openSettingsPane(occPage, 'appearance')
    await occPage.getByRole('combobox', { name: 'Dark theme', exact: true }).click()
    const options = occPage.getByRole('option', { name: /^Catppuccin Mocha/ })
    await expect(options).toHaveCount(2)
    await occPage.screenshot({
      path: join(proofDir ?? testInfo.outputPath(), 'theme-picker.png')
    })
    await expect(occPage.getByRole('option', { name: 'Catppuccin Mocha (acme)' })).toBeVisible()
    await expect(occPage.getByRole('option', { name: 'Catppuccin Mocha (vale-c)' })).toBeVisible()
    await occPage.keyboard.press('Escape')

    await openSettingsPane(occPage, 'plugins')
    const section = occPage.locator('[data-settings-section="plugins"]')
    await expect(section.getByText(/^Catppuccin for OCC/).first()).toBeVisible()
    await occPage.screenshot({
      path: join(proofDir ?? testInfo.outputPath(), 'plugin-list.png')
    })
    await expect(section.getByText('Catppuccin for OCC (acme)', { exact: true })).toBeVisible()
    await expect(section.getByText('Catppuccin for OCC (vale-c)', { exact: true })).toBeVisible()
  } finally {
    await disablePluginSystem(occPage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
