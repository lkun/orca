import { test, expect } from './helpers/occ-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why: on narrow windows the titlebar tab strip switches panels the board covers.
test.describe('Workspace board right-sidebar tab dismiss', () => {
  test.skip(process.platform !== 'darwin', 'Linux and Windows draw the tab strip under the board')

  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
  })

  test('clicking a right-sidebar tab closes the board and shows that tab', async ({
    electronApp,
    occPage
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1000, 800)
    })
    await occPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('window.__store is not available')
      }
      state.setSidebarOpen(true)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('explorer')
    })

    await occPage.getByRole('button', { name: 'Workspace board' }).click()
    const board = occPage.locator('[data-workspace-board-sheet]')
    await expect(board).toBeVisible()
    await board.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

    await occPage.getByRole('button', { name: /^Source Control/ }).click()

    await expect(board).toBeHidden()
    await expect(occPage.getByTestId('source-control-filter-toggle')).toBeVisible()
  })
})
