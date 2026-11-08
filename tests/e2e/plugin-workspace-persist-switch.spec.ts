/**
 * Invariant: a components panel's `persist: 'workspace'` atom keeps an edit made just before a
 * workspace switch (inside the 400 ms persist debounce) under the workspace it was typed in, and
 * the workspace switched to keeps its own value.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'
import { ISOLATED_FRAMES_E2E } from './helpers/plugin-frame-guest'
import { switchToOtherWorktree, switchToWorktree, waitForActiveWorktree } from './helpers/store'

test.use(ISOLATED_FRAMES_E2E)

const TITLE = 'Workspace Draft'

const PANEL = `import { atom, Input, read, set, Stack, Text } from 'occ'

const draft = atom('e2e.workspaceDraft', '', { persist: 'workspace' })

export default function Panel() {
  return (
    <Stack gap="sm">
      <Input label="Draft" value={read(draft)} onChange={(value) => set(draft, value)} />
      <Text>{'echo:' + read(draft)}</Text>
    </Stack>
  )
}
`

async function writePlugin(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'occ-plugin.json'),
    JSON.stringify({
      manifestVersion: 2,
      execution: 'sandboxed-ui',
      id: 'workspace-draft',
      name: TITLE,
      version: '1.0.0',
      engines: { occ: '>=1.4.246' },
      pluginApi: 1,
      contributes: {
        panels: [{ id: 'draft', title: TITLE, entry: 'src/panel.tsx', ui: 'components' }]
      },
      capabilities: []
    })
  )
  await writeFile(join(root, 'src', 'panel.tsx'), PANEL)
}

/** Types into the panel, waits for the guest to echo it (so its persist is pending), then switches. */
async function typeThenSwitch(page: Page, value: string, toWorktreeId: string): Promise<void> {
  // Why retry: a guest still settling after the panel opens may drop the first edit.
  await expect(async () => {
    await page.getByRole('textbox', { name: 'Draft' }).fill(value)
    await expect(page.getByText(`echo:${value}`, { exact: true })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  // Well inside the guest's 400 ms persist debounce.
  await switchToWorktree(page, toWorktreeId)
}

async function expectDraft(page: Page, value: string): Promise<void> {
  await expect(page.getByText(`echo:${value}`, { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue(value)
}

test('a workspace atom edit made just before a switch stays with its workspace', async ({
  occPage
}) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'occ-workspace-draft-'))
  const pluginRoot = join(tempRoot, 'workspace-draft')
  try {
    await writePlugin(pluginRoot)
    const worktreeA = await waitForActiveWorktree(occPage)
    const worktreeB = await switchToOtherWorktree(occPage, worktreeA)
    test.skip(!worktreeB, 'the seeded repo has a single worktree')
    await switchToWorktree(occPage, worktreeA)

    await enableDevPlugins(occPage, [pluginRoot])
    await occPage.evaluate(async () => {
      const store = window.__store?.getState()
      if (store && !store.rightSidebarOpen) {
        store.toggleRightSidebar()
      }
      await window.api.plugins.refresh()
    })
    const panelButton = occPage.getByRole('button', { name: TITLE })
    await expect(panelButton).toBeVisible({ timeout: 15_000 })
    await panelButton.click()
    await expectDraft(occPage, '')

    // Typed in A, switched to B before A's write left the guest.
    await typeThenSwitch(occPage, 'typed in A', worktreeB!)
    await expectDraft(occPage, '')
    await switchToWorktree(occPage, worktreeA)
    await expectDraft(occPage, 'typed in A')

    // Rapid A, B, A: typed in A, then out and straight back, with B's own value untouched.
    await switchToWorktree(occPage, worktreeB!)
    await expectDraft(occPage, '')
    await typeThenSwitch(occPage, 'typed in B', worktreeA)
    await switchToWorktree(occPage, worktreeB!)
    await switchToWorktree(occPage, worktreeA)
    await expectDraft(occPage, 'typed in A')
    await switchToWorktree(occPage, worktreeB!)
    await expectDraft(occPage, 'typed in B')

    // Stored, not only in the guest: a reopened panel (a new guest) reads both back.
    await disablePluginSystem(occPage)
    await enableDevPlugins(occPage, [pluginRoot])
    await occPage.evaluate(() => window.api.plugins.refresh())
    await expect(panelButton).toBeVisible({ timeout: 15_000 })
    await panelButton.click()
    await expectDraft(occPage, 'typed in B')
    await switchToWorktree(occPage, worktreeA)
    await expectDraft(occPage, 'typed in A')
  } finally {
    await disablePluginSystem(occPage).catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
