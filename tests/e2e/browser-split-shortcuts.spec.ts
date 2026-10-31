import { expect, test } from './helpers/occ-app'
import type { Page } from '@stablyai/playwright-test'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserAddressBar,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier as modifier,
  waitForFocusedGroup
} from './helpers/browser-split-fixture'

function browserFindInput(page: Page) {
  return page.getByPlaceholder('Find in page...')
}

function browserFindCloseButton(page: Page) {
  return browserFindInput(page).locator('xpath=..').getByTitle('Close')
}

function browserSplitFindInput(page: Page, browserTabId: string) {
  return page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)
    .getByPlaceholder('Find in page...')
}

async function pressFindInBrowserGuest(
  page: Page,
  browserTabId: string,
  browserPageId: string
): Promise<void> {
  await pressKeyInBrowserGuest(page, browserTabId, browserPageId, 'F', [guestModifier])
}

function terminalFindInput(page: Page) {
  return page.locator('[data-terminal-search-root] input:visible')
}

test.describe('browser split shortcuts', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
  })

  test('routes repeated Find shortcuts to the focused terminal or browser split', async ({
    occPage
  }) => {
    const fixture = await createTerminalBrowserSplit(occPage)

    await occPage.evaluate(({ terminalGroupId }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (state && worktreeId) {
        state.focusGroup(worktreeId, terminalGroupId)
      }
    }, fixture)
    await focusActiveTerminalInput(occPage)
    await waitForFocusedGroup(occPage, fixture.terminalGroupId)
    await occPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(occPage)).toBeFocused()
    await expect(browserFindInput(occPage)).toBeHidden()
    await occPage.keyboard.press('Escape')

    await focusBrowserGroup(occPage, fixture.browserGroupId)
    await focusBrowserAddressBar(occPage, fixture.browserTabId)
    await occPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(occPage)).toBeFocused()
    await expect(terminalFindInput(occPage)).toBeHidden()
    await browserFindCloseButton(occPage).click()
    await expect(browserFindInput(occPage)).toBeHidden()

    await occPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(occPage)).toBeFocused()
    await browserFindCloseButton(occPage).click()

    await occPage.evaluate(({ browserTabId }) => {
      window.__store?.getState().closeBrowserTab(browserTabId)
    }, fixture)
    await expect(
      occPage.locator(`[data-browser-overlay-tab-id="${fixture.browserTabId}"]`)
    ).toHaveCount(0)

    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(occPage)).toBeFocused()
    await expect(browserFindInput(occPage)).toBeHidden()
  })

  test('opens Find only in the browser split whose guest owns the shortcut', async ({
    occPage
  }) => {
    const fixture = await createBrowserSplit(occPage)

    await pressFindInBrowserGuest(occPage, fixture.firstBrowserTabId, fixture.firstBrowserPageId)

    await expect(browserSplitFindInput(occPage, fixture.firstBrowserTabId)).toBeVisible()
    await expect(browserSplitFindInput(occPage, fixture.secondBrowserTabId)).toBeHidden()
    await expect
      .poll(() =>
        occPage.evaluate(
          ({ browserPageId, browserTabId }) =>
            window.__store
              ?.getState()
              .browserPagesByWorkspace[browserTabId]?.find((page) => page.id === browserPageId)
              ?.loadError?.code ?? null,
          {
            browserPageId: fixture.firstBrowserPageId,
            browserTabId: fixture.firstBrowserTabId
          }
        )
      )
      .toBeNull()
  })

  test('keeps browser Find available when split focus state is temporarily missing', async ({
    occPage
  }) => {
    const fixture = await createTerminalBrowserSplit(occPage)
    await focusBrowserGroup(occPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(occPage, fixture.browserTabId)
    await focusBrowserAddressBar(occPage, fixture.browserTabId)

    await occPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => {
        const activeGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete activeGroupIdByWorktree[worktreeId]
        return { activeGroupIdByWorktree }
      })
    })
    await expect(addressBar).toBeFocused()

    await occPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(occPage)).toBeFocused()
    await expect(terminalFindInput(occPage)).toBeHidden()
  })

  test('keeps browser Find available when the focused split ID is stale', async ({ occPage }) => {
    const fixture = await createTerminalBrowserSplit(occPage)
    await focusBrowserGroup(occPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(occPage, fixture.browserTabId)
    await focusBrowserAddressBar(occPage, fixture.browserTabId)

    await occPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => ({
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: 'removed-group'
        }
      }))
    })
    await expect(addressBar).toBeFocused()

    await occPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(occPage)).toBeFocused()
    await expect(terminalFindInput(occPage)).toBeHidden()
  })
})
