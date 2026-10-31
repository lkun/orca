import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/occ-app'
import { splitActiveTerminalPane, waitForPaneCount } from './helpers/terminal'
import { getActiveWorktreeId, getActiveTabId, getWorktreeTabs } from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import {
  setPaneTitleFromTerminalMenu,
  openTerminalContextMenu
} from './helpers/terminal-pane-title-actions'
import {
  readVisibleXtermContainerBox,
  expectTerminalToReserveTitleSpace
} from './helpers/terminal-pane-geometry'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

async function openPaneTitleContextMenu(page: Page, title: string): Promise<void> {
  const modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = (await page.evaluate(() =>
    navigator.userAgent.includes('Windows')
  ))
    ? ['Control']
    : []
  const isMac = await page.evaluate(() => navigator.userAgent.includes('Mac'))
  const titleBar = page.locator('.pane-title-bar', { hasText: title }).first()
  await expect(titleBar).toBeVisible()
  await titleBar.click({
    button: isMac ? 'left' : 'right',
    position: { x: 20, y: 10 },
    modifiers: isMac ? ['Control'] : modifiers
  })
  await expect(page.getByText('Set Title…', { exact: true })).toBeVisible()
}

async function getTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string
): Promise<string | null> {
  return page.evaluate(
    ({ targetWorktreeId, targetTabId }) => {
      const state = window.__store!.getState()
      const tab = (state.tabsByWorktree[targetWorktreeId] ?? []).find(
        (entry) => entry.id === targetTabId
      )
      return tab?.customTitle ?? null
    },
    { targetWorktreeId: worktreeId, targetTabId: tabId }
  )
}

async function expectTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string,
  expected: string | null
): Promise<void> {
  await expect
    .poll(() => getTabCustomTitle(page, worktreeId, tabId), { timeout: 3_000 })
    .toBe(expected)
}

async function expectSavedLayoutNotToContainTitle(
  page: Page,
  tabId: string,
  title: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ targetTabId, title }) => {
            const layout = window.__store!.getState().terminalLayoutsByTabId[targetTabId]
            return Object.values(layout?.titlesByLeafId ?? {}).includes(title)
          },
          { targetTabId: tabId, title }
        ),
      { timeout: 3_000 }
    )
    .toBe(false)
}

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('first Set Title from terminal context menu stays open for typing', async ({ occPage }) => {
    const title = `First menu title ${Date.now()}`

    await openTerminalContextMenu(occPage)
    await occPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = occPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await occPage.waitForTimeout(250)
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()

    await titleInput.fill(title)
    await titleInput.press('Enter')

    await expect(titleInput).toHaveCount(0)
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title editor renders in OCC overlay while terminal reserves title space', async ({
    occPage
  }) => {
    const title = `Reserved overlay title ${Date.now()}`
    const terminalBoxBefore = await readVisibleXtermContainerBox(occPage)

    await openTerminalContextMenu(occPage)
    await occPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = occPage.locator('.pane-title-overlay-layer .pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(occPage.getByText('Set Title…', { exact: true })).toBeHidden()
    await expect(occPage.locator('.pane .pane-title-input')).toHaveCount(0)
    await expect(occPage.locator('.pane[data-has-title]')).toHaveCount(1)
    await expect
      .poll(() =>
        occPage
          .locator('.pane-title-bar')
          .first()
          .evaluate((titleBar) => getComputedStyle(titleBar).backgroundColor)
      )
      .not.toBe('rgba(0, 0, 0, 0)')
    const terminalBoxEditing = await readVisibleXtermContainerBox(occPage)
    expectTerminalToReserveTitleSpace(terminalBoxEditing, terminalBoxBefore)

    await titleInput.fill(title)
    await titleInput.press('Enter')
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
    await expect(occPage.locator('.pane[data-has-title]')).toHaveCount(1)
    expectTerminalToReserveTitleSpace(
      await readVisibleXtermContainerBox(occPage),
      terminalBoxBefore
    )
  })

  test('Set Title context menu opens from the title overlay strip', async ({ occPage }) => {
    const title = `Overlay menu title ${Date.now()}`
    const updatedTitle = `Overlay menu updated ${Date.now()}`

    await setPaneTitleFromTerminalMenu(occPage, title)
    await openPaneTitleContextMenu(occPage, title)
    await occPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = occPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(titleInput).toHaveValue(title)
    await titleInput.fill(updatedTitle)
    await titleInput.press('Enter')

    await expect(occPage.locator('.pane-title-text', { hasText: updatedTitle })).toHaveCount(1)
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toHaveCount(0)
  })

  test('Set Title commits when tabbing away from the title input', async ({ occPage }) => {
    const title = `Tab commit title ${Date.now()}`

    await openTerminalContextMenu(occPage)
    await occPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = occPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await titleInput.fill(title)
    await titleInput.press('Tab')

    await expect(titleInput).toHaveCount(0)
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title overlay hides with its inactive terminal tab', async ({ occPage }) => {
    const title = `Hidden tab title ${Date.now()}`
    const worktreeId = (await getActiveWorktreeId(occPage))!

    await setPaneTitleFromTerminalMenu(occPage, title)
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toBeVisible()

    await pressShortcut(occPage, 't')
    await expect
      .poll(async () => (await getWorktreeTabs(occPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toBeHidden()

    await pressShortcut(occPage, 'BracketLeft', { shift: true })
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
  })

  test('Set Title still commits by blur after focus settles', async ({ occPage }) => {
    const title = `Blur commit title ${Date.now()}`

    await openTerminalContextMenu(occPage)
    await occPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = occPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await occPage.waitForTimeout(100)
    await titleInput.fill(title)
    await occPage
      .locator('.xterm:visible')
      .first()
      .click({ position: { x: 40, y: 60 } })

    await expect(titleInput).toHaveCount(0)
    await expect(occPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title stays pane-local during agent title churn', async ({ occPage }) => {
    const worktreeId = (await getActiveWorktreeId(occPage))!
    const tabId = (await getActiveTabId(occPage))!
    const paneTitle = `Codex pane ${Date.now()}`
    const removeButtonTitle = `Remove button label ${Date.now()}`
    const splitTitle = `Split label ${Date.now()}`
    const runtimeTitle = '⠋ Codex working'

    await setPaneTitleFromTerminalMenu(occPage, paneTitle)
    await expect(occPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expectTabCustomTitle(occPage, worktreeId, tabId, null)

    await occPage.getByRole('button', { name: `Edit pane title: ${paneTitle}` }).focus()
    await occPage.keyboard.press('Enter')
    const paneTitleInput = occPage.getByRole('textbox', { name: 'Pane title' })
    await expect(paneTitleInput).toBeVisible()
    await expect(paneTitleInput).toBeFocused()
    await occPage.keyboard.press('Escape')
    await expect(paneTitleInput).toHaveCount(0)
    await expect(occPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()

    await occPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )

    // OSC titles may churn continuously; pane-local Set Title must remain visible while tab runtime title follows the active PTY.
    await expect(occPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expect(
      occPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
    await expectTabCustomTitle(occPage, worktreeId, tabId, null)

    await setPaneTitleFromTerminalMenu(occPage, '')
    await expect(occPage.locator('.pane-title-text', { hasText: paneTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(occPage, tabId, paneTitle)

    await setPaneTitleFromTerminalMenu(occPage, removeButtonTitle)
    await setPaneTitleFromTerminalMenu(occPage, '')
    await expect(occPage.locator('.pane-title-text', { hasText: removeButtonTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(occPage, tabId, removeButtonTitle)

    await setPaneTitleFromTerminalMenu(occPage, splitTitle)
    await expectTabCustomTitle(occPage, worktreeId, tabId, null)

    await splitActiveTerminalPane(occPage, 'vertical')
    await waitForPaneCount(occPage, 2)
    await expect(occPage.locator('.pane-title-text', { hasText: splitTitle })).toBeVisible()

    await occPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )
    await expect(
      occPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
  })
})
