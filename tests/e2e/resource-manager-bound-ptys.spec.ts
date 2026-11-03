import { expect, test } from './helpers/occ-app'
import { makeResourceManagerFixtureVisible } from './helpers/resource-manager-visible-fixture'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePanePtyId } from './helpers/terminal'

for (const theme of ['light', 'dark'] as const) {
  test(`PTY navigation keeps Resource Manager open while browsing and ending terminals (${theme})`, async ({
    electronApp,
    occPage
  }, testInfo) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    await occPage.setViewportSize({ width: 1200, height: 900 })
    await occPage.evaluate(async (theme) => {
      await window.__store!.getState().updateSettingsOrThrow({ theme })
    }, theme)
    const terminals: { tabId: string; ptyId: string; title: string }[] = []
    for (const title of ['Terminal 1', 'Terminal 8', '工作日仓库审计 run 33']) {
      const tabId = await occPage.evaluate(
        ({ title, create }) => {
          const state = window.__store!.getState()
          const workspaceId = state.activeWorktreeId
          if (!workspaceId || !state.activeTabId) {
            throw new Error('Missing active workspace or tab')
          }
          const tabId = create ? state.createTab(workspaceId).id : state.activeTabId
          state.setActiveTab(tabId)
          state.setTabCustomTitle(tabId, title)
          return tabId
        },
        { title, create: terminals.length > 0 }
      )
      terminals.push({ title, tabId, ptyId: await waitForActivePanePtyId(occPage) })
    }
    await makeResourceManagerFixtureVisible(electronApp, occPage)
    const openPtys = async (): Promise<void> => {
      await occPage.getByRole('button', { name: /^Resource Manager,/ }).click()
      await occPage.getByRole('tab', { name: /^PTYs/ }).click()
    }
    await openPtys()
    await expect(occPage.getByText('3 OCC PTYs on this computer')).toBeVisible()
    const body = occPage.locator('[data-resource-pty-body]')
    await occPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`bound-ptys-collapsed-${theme}.png`)
    })
    for (const terminal of terminals) {
      await expect(
        body.getByRole('button', { name: `Open ${terminal.title}`, exact: true })
      ).toBeVisible()
      await expect(
        body.getByRole('button', { name: `End ${terminal.title}`, exact: true })
      ).toBeEnabled()
    }
    const panel = occPage.getByRole('tabpanel', { name: /^PTYs/ })
    const first = terminals[0]
    await expect(panel.getByRole('searchbox')).toHaveCount(0)
    await expect(panel.getByRole('combobox')).toHaveCount(0)
    await expect(body.getByRole('button', { name: 'Open Terminal 8', exact: true })).toBeVisible()
    const details = body.getByRole('button', { name: `Details for ${first.title}`, exact: true })
    await details.click()
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(body.locator('dl').getByText(first.ptyId, { exact: true })).toBeVisible()
    await details.click()
    for (const terminal of terminals) {
      await body.getByRole('button', { name: `Open ${terminal.title}`, exact: true }).click()
      await expect(body).toBeVisible()
      await expect(
        occPage.locator(`[data-testid="sortable-tab"][data-tab-id="${terminal.tabId}"]`)
      ).toHaveAttribute('data-active', 'true')
    }
    await body.getByRole('button', { name: `End ${first.title}`, exact: true }).click()
    await expect(occPage.getByRole('dialog', { name: `End ${first.title}?` })).toHaveCount(0)
    await expect(occPage.getByText('2 OCC PTYs on this computer')).toBeVisible()
    await expect(
      body.getByRole('button', { name: `Open ${first.title}`, exact: true })
    ).toHaveCount(0)
    await occPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`bound-ptys-${theme}.png`)
    })
    await expect(occPage.getByRole('heading', { name: `End ${first.title}?` })).toHaveCount(0)
    for (const terminal of terminals.slice(1)) {
      await body.getByRole('checkbox', { name: `Select ${terminal.title}`, exact: true }).check()
    }
    await occPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`bound-ptys-selected-${theme}.png`)
    })
    await panel.getByRole('button', { name: 'End selected (2)', exact: true }).click()
    await expect(occPage.getByText('0 OCC PTYs on this computer')).toBeVisible()
    await expect(body.getByText('No local OCC PTYs', { exact: true })).toBeVisible()
    await expect(occPage.getByRole('dialog', { name: /^End / })).toHaveCount(0)
    await occPage.keyboard.press('Escape')
    await expect(body).toHaveCount(0)
  })
}
