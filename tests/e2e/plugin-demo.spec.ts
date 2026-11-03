// Require visible consent before the hello-occ panel, worker command or event subscription runs.

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { removeWorktreeViaStore } from './helpers/dead-terminal'
import {
  pluginGuest,
  readGuestCsp,
  readInGuest,
  ISOLATED_FRAMES_E2E
} from './helpers/plugin-frame-guest'

// Isolated frames are off by default; these journeys exercise the guest path.
test.use(ISOLATED_FRAMES_E2E)

async function openPluginSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'plugins', repoId: null })
    state.openSettingsPage()
  })
  const section = page.locator('[data-settings-section="plugins"]')
  await expect(section).toBeVisible()
  await expect(section.getByText('Alpha', { exact: true })).toBeVisible()
}

async function openDemoPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.closeSettingsPage()
    if (!state.rightSidebarOpen) {
      state.toggleRightSidebar()
    }
  })
  const panelButton = page.getByRole('button', { name: 'Hello OCC', exact: true })
  await expect(panelButton).toBeVisible({ timeout: 15_000 })
  await panelButton.click()
  const guest = pluginGuest(page, 'Hello OCC')
  await expect(guest).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => readDemoHeading(page)).toBe('Hello OCC 👋')
  expect(await readGuestCsp(guest)).toMatch(/default-src 'self'.*connect-src 'self' data: blob:/)
}

function readDemoHeading(page: Page): Promise<string | null> {
  return readInGuest<string | null>(
    pluginGuest(page, 'Hello OCC'),
    `document.querySelector('h1')?.textContent ?? null`
  )
}

async function createWorktree(page: Page, name: string): Promise<string> {
  await page.waitForFunction(
    () => {
      const state = window.__store?.getState()
      return Boolean(state && Object.values(state.worktreesByRepo).flat().length > 0)
    },
    undefined,
    { timeout: 15_000 }
  )
  return page.evaluate(async (worktreeName) => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    const worktrees = Object.values(state.worktreesByRepo).flat()
    const active =
      worktrees.find((worktree) => worktree.id === state.activeWorktreeId) ?? worktrees[0]
    if (!active) {
      throw new Error('active worktree was not found')
    }
    const result = await state.createWorktree(active.repoId, worktreeName)
    return result.worktree.id
  }, name)
}

test('runs hello-occ panel, command, and event behind visible consent', async ({ occPage }) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'occ-hello-plugin-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-occ')
  let createdWorktreeId: string | null = null
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-occ'), pluginRoot, {
    recursive: true
  })

  try {
    const installed = await occPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      const pending = (await window.api.plugins.refresh()).find(
        (entry) => entry.pluginKey === result.pluginKey
      )
      if (!pending) {
        throw new Error('installed plugin was not listed')
      }
      let blocked = false
      try {
        await window.api.plugins.invokeCommand({
          pluginKey: result.pluginKey,
          commandId: 'hello-ping',
          args: { source: 'before-consent' }
        })
      } catch {
        blocked = true
      }
      return { pluginKey: result.pluginKey, status: pending.status, blocked }
    }, pluginRoot)

    expect(installed.status).toBe('pending')
    expect(installed.blocked).toBe(true)

    await openPluginSettings(occPage)
    await occPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = occPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    // Why on the page: review sits above its one button there, not in a dialog over the list.
    await row.getByRole('button', { name: 'Review', exact: true }).click()
    const consent = occPage.locator('[data-plugin-consent]')
    await expect(consent).toBeVisible()
    await expect(occPage.getByRole('article')).toContainText('Local folder')
    await expect(consent).toContainText(
      'Full access: runs as a normal program and can read your files, use the network and run other programs.'
    )
    await expect(occPage.getByRole('dialog')).toHaveCount(0)
    await occPage
      .getByRole('article')
      .getByRole('button', { name: /^Enable plugin/ })
      .click()
    await expect(consent).toBeHidden()
    await occPage
      .getByRole('article')
      .getByRole('button', { name: 'Plugins', exact: true })
      .click()
    await occPage.getByRole('tab', { name: /^Installed/ }).click()
    await expect(row).toContainText('Installed')

    const commandResults = await occPage.evaluate(async (pluginKey) => {
      const first = await window.api.plugins.invokeCommand({
        pluginKey,
        commandId: 'hello-ping',
        args: { source: 'e2e' }
      })
      const second = await window.api.plugins.invokeCommand({
        pluginKey,
        commandId: 'hello-ping',
        args: { source: 'e2e' }
      })
      return { first, second }
    }, installed.pluginKey)
    expect(commandResults.first).toBe('Pong! First ping.')
    expect(commandResults.second).toBe('Pong! 2 pings so far.')

    await occPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ devPluginPaths: [sourcePath] })
      window.__store?.setState({ settings })
      await window.api.plugins.refresh()
    }, pluginRoot)
    // A dev folder taking over the approved install is different code, so it needs its own review.
    await occPage.evaluate(async (pluginKey) => {
      const plugin = (await window.api.plugins.list()).find(
        (entry) => entry.pluginKey === pluginKey
      )
      if (!plugin?.consentFingerprint || plugin.status !== 'pending') {
        throw new Error('the dev copy should wait for review')
      }
      await window.api.plugins.consent({
        pluginKey,
        reviewedFingerprint: plugin.consentFingerprint,
        decision: 'approve'
      })
    }, installed.pluginKey)

    await openDemoPanel(occPage)

    const panelPath = join(pluginRoot, 'panel.html')
    const panelHtml = await readFile(panelPath, 'utf8')
    await writeFile(panelPath, panelHtml.replace('Hello OCC 👋', 'Hello OCC reloaded'))
    await expect
      .poll(() => readDemoHeading(occPage), { timeout: 15_000 })
      .toBe('Hello OCC reloaded')

    createdWorktreeId = await createWorktree(occPage, `plugin-event-${Date.now()}`)
    await expect
      .poll(
        () =>
          occPage.evaluate(
            async ({ pluginKey, worktreeId }) =>
              (await window.api.plugins.getLogs({ pluginKey })).some(
                (entry) =>
                  entry.line.includes('worktree created:') && entry.line.includes(worktreeId)
              ),
            { pluginKey: installed.pluginKey, worktreeId: createdWorktreeId! }
          ),
        { timeout: 15_000 }
      )
      .toBe(true)
  } finally {
    try {
      if (createdWorktreeId) {
        await removeWorktreeViaStore(occPage, createdWorktreeId)
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
})
