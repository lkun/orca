// #10142: keyboard and X close must both confirm for the same live sleep 300 child, preserving the tab until approval.
import { test, expect } from './helpers/occ-app'
import type { Page } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveTabId,
  ensureTerminalVisible
} from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function countRenderedTabs(page: Page): Promise<number> {
  return page.locator(SORTABLE_TAB).count()
}

function closeDialogTitle(page: Page) {
  return page.getByText(/Stop running command\?|Stop this agent\?/)
}

test.describe.configure({ mode: 'serial' })

test('the tab X button applies the same running-process confirmation as Cmd+W', async ({
  occPage
}) => {
  test.setTimeout(120_000)
  await waitForSessionReady(occPage)
  await waitForActiveWorktree(occPage)
  await ensureTerminalVisible(occPage)
  const hasPaneManager = await waitForActiveTerminalManager(occPage, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(!hasPaneManager, 'Electron automation never mounted the live TerminalPane manager.')
  await waitForPaneCount(occPage, 1, 30_000)

  const ptyId = await waitForActivePanePtyId(occPage)
  await execInTerminal(occPage, ptyId, 'echo repro-10142-ready')
  await waitForTerminalOutput(occPage, 'repro-10142-ready', 20_000)
  await execInTerminal(occPage, ptyId, 'sleep 300')
  // Wait for sleep as foreground process; macOS login makes hasChildProcesses true before the command starts.
  await expect
    .poll(
      async () =>
        (await occPage.evaluate((id) => window.api.pty.inspectProcess(id), ptyId))
          .foregroundProcess,
      { timeout: 20_000, message: 'sleep 300 never became the foreground process' }
    )
    .toBe('sleep')

  const busyTabId = (await getActiveTabId(occPage))!
  const busyTab = occPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()

  await focusActiveTerminalInput(occPage)
  await occPage.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
  await expect(closeDialogTitle(occPage)).toBeVisible({ timeout: 15_000 })
  await occPage.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(closeDialogTitle(occPage)).toBeHidden()
  await expect(busyTab).toBeVisible()
  const tabsBefore = await countRenderedTabs(occPage)

  await busyTab.hover()
  await busyTab.getByRole('button', { name: /^Close tab /i }).click()
  await occPage.waitForTimeout(1_500)

  expect(
    {
      confirmDialogVisible: await closeDialogTitle(occPage).isVisible(),
      tabStillPresent: (await countRenderedTabs(occPage)) === tabsBefore
    },
    'X-button close must apply the same running-process confirmation as Cmd+W'
  ).toEqual({ confirmDialogVisible: true, tabStillPresent: true })
})
