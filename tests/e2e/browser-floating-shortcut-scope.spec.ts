// STA-8147 follow-up: the floating browser and a focused split browser each answer only the
// chrome chords pressed inside them.

import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  browserOverlay,
  createTerminalBrowserSplit,
  focusBrowserGroup,
  pressKeyInBrowserGuest,
  shortcutModifier
} from './helpers/browser-split-fixture'
import {
  guestLoadStarts,
  navigateGuest,
  recordGuestLoadStarts,
  waitForGuestIdle,
  waitForGuestUrl
} from './helpers/browser-split-guest-probes'
import { startBrowserSplitPageServer } from './helpers/browser-split-page-server'

// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID in src/shared/constants.ts.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
const FLOATING_PANEL = '[data-floating-terminal-panel]'
const isMac = process.platform === 'darwin'
const backChord = isMac ? 'Meta+BracketLeft' : 'Alt+ArrowLeft'
const forwardChord = isMac ? 'Meta+BracketRight' : 'Alt+ArrowRight'

async function openFloatingBrowser(
  page: Page,
  url: string
): Promise<{ browserTabId: string; browserPageId: string }> {
  const floating = await page.evaluate(
    ({ worktreeId, initialUrl }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const settings = store.getState().settings
      if (!settings) {
        throw new Error('Settings are not loaded')
      }
      store.setState({ settings: { ...settings, floatingTerminalEnabled: true } })
      const state = store.getState()
      const tab = state.createBrowserTab(worktreeId, initialUrl, {
        activate: true,
        focusAddressBar: false,
        targetGroupId: state.ensureWorktreeRootGroup(worktreeId),
        browserRuntimeEnvironmentId: null
      })
      if (!tab.activePageId) {
        throw new Error('Floating browser page unavailable')
      }
      return { browserTabId: tab.id, browserPageId: tab.activePageId }
    },
    { worktreeId: FLOATING_WORKTREE_ID, initialUrl: url }
  )
  // Why: the toggle listener closes over floatingTerminalEnabled, so wait for the panel to mount.
  await expect(page.locator(FLOATING_PANEL)).toHaveCount(1)
  const openPanel = page.locator(`${FLOATING_PANEL}[aria-hidden="false"]`)
  if ((await openPanel.count()) === 0) {
    await page.evaluate(() => window.dispatchEvent(new Event('occ-toggle-floating-terminal')))
  }
  await expect(
    openPanel.locator(`[data-browser-overlay-tab-id="${floating.browserTabId}"]`)
  ).toBeVisible()
  return floating
}

function findInput(page: Page, browserTabId: string) {
  return browserOverlay(page, browserTabId).getByPlaceholder('Find in page...')
}

function cancelGrabButton(page: Page, browserTabId: string) {
  return browserOverlay(page, browserTabId).getByRole('button', {
    name: 'Cancel',
    exact: true
  })
}

// Why: a non-editable chrome target, so reload and grab are not skipped as text-field keys.
async function focusChrome(page: Page, browserTabId: string): Promise<void> {
  // Reload stays in the toolbar when narrow panes fold their element tools into the menu.
  const target = browserOverlay(page, browserTabId).getByRole('button', {
    name: 'Reload',
    exact: true
  })
  await expect(target).toBeEnabled()
  await target.focus()
  await expect(target).toBeFocused()
}

test.describe('floating browser shortcut scope', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
  })

  test('chrome shortcuts act only in the pane that owns the key press', async ({ occPage }) => {
    const server = await startBrowserSplitPageServer()
    try {
      const split = await createTerminalBrowserSplit(occPage, server.pageUrl('split', 1))
      const floating = await openFloatingBrowser(occPage, server.pageUrl('float', 1))
      await focusBrowserGroup(occPage, split.browserGroupId)
      await waitForGuestUrl(occPage, split.browserTabId, server.pageUrl('split', 1))
      await waitForGuestUrl(occPage, floating.browserTabId, server.pageUrl('float', 1))
      await navigateGuest(occPage, split.browserTabId, server.pageUrl('split', 2))
      await navigateGuest(occPage, floating.browserTabId, server.pageUrl('float', 2))

      const cases = [
        {
          name: 'float',
          owner: floating.browserTabId,
          other: split.browserTabId,
          otherName: 'split'
        },
        {
          name: 'split',
          owner: split.browserTabId,
          other: floating.browserTabId,
          otherName: 'float'
        }
      ]
      for (const { name, owner, other, otherName } of cases) {
        await test.step(`keys pressed in the ${name} browser chrome`, async () => {
          await focusChrome(occPage, owner)
          await occPage.keyboard.press(backChord)
          await waitForGuestUrl(occPage, owner, server.pageUrl(name, 1))
          await waitForGuestIdle(occPage, other)
          await waitForGuestUrl(occPage, other, server.pageUrl(otherName, 2))
          await focusChrome(occPage, owner)
          await occPage.keyboard.press(forwardChord)
          await waitForGuestUrl(occPage, owner, server.pageUrl(name, 2))
          await waitForGuestUrl(occPage, other, server.pageUrl(otherName, 2))

          await recordGuestLoadStarts(occPage, [owner, other])
          await focusChrome(occPage, owner)
          await occPage.keyboard.press(`${shortcutModifier}+r`)
          await expect.poll(() => guestLoadStarts(occPage, owner)).toBeGreaterThan(0)
          await waitForGuestIdle(occPage, owner)
          expect(await guestLoadStarts(occPage, other)).toBe(0)

          await focusChrome(occPage, owner)
          await occPage.keyboard.press(`${shortcutModifier}+f`)
          await expect(findInput(occPage, owner)).toBeFocused()
          await expect(findInput(occPage, other)).toBeHidden()
          await occPage.keyboard.press('Escape')
          await expect(findInput(occPage, owner)).toBeHidden()

          await focusChrome(occPage, owner)
          await occPage.keyboard.press(`${shortcutModifier}+l`)
          await expect(browserAddressBar(occPage, owner)).toBeFocused()

          await focusChrome(occPage, owner)
          await occPage.keyboard.press(`${shortcutModifier}+c`)
          await expect(cancelGrabButton(occPage, owner)).toBeVisible()
          await expect(cancelGrabButton(occPage, other)).toBeHidden()
          await cancelGrabButton(occPage, owner).click()
          await expect(cancelGrabButton(occPage, owner)).toBeHidden()
        })
      }

      await test.step('back pressed inside the floating page', async () => {
        await pressKeyInBrowserGuest(
          occPage,
          floating.browserTabId,
          floating.browserPageId,
          isMac ? '[' : 'Left',
          [isMac ? 'meta' : 'alt']
        )
        await waitForGuestUrl(occPage, floating.browserTabId, server.pageUrl('float', 1))
        await waitForGuestUrl(occPage, split.browserTabId, server.pageUrl('split', 2))
      })
    } finally {
      await server.close()
    }
  })
})
