import { test, expect } from './helpers/occ-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Cmd+J focuses the terminal after waking a sleeping workspace', async ({
  occPage
}, testInfo) => {
  await waitForSessionReady(occPage)
  const source = await waitForActiveWorktree(occPage)
  const target = (await getAllWorktreeIds(occPage)).find((id) => id !== source)
  if (!target) {
    throw new Error('Expected a second seeded workspace')
  }
  await switchToWorktree(occPage, target)
  await ensureTerminalVisible(occPage)
  await waitForActiveTerminalManager(occPage)
  await waitForActivePanePtyId(occPage)
  const targetName = await occPage.evaluate((id) => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(id)
    if (!worktree) {
      throw new Error('Missing target workspace')
    }
    return worktree.branch.replace(/^refs\/heads\//, '')
  }, target)
  await switchToWorktree(occPage, source)
  await occPage.evaluate(async (id) => {
    await window.__store!.getState().shutdownWorktreeTerminals(id, { keepIdentifiers: true })
  }, target)
  await occPage.evaluate(() => {
    const listSessions = window.api.pty.listSessions
    window.api.pty.listSessions = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return listSessions(...args)
    }
  })
  // Native menu accelerators require OS focus; open the same palette in the hidden renderer.
  await occPage.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  const dialog = occPage.getByRole('dialog', { name: 'Jump to...' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(targetName)
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toContainText(targetName)
  const cdp = await occPage.context().newCDPSession(occPage)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await occPage.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await waitForActiveTerminalManager(occPage)
  await waitForActivePanePtyId(occPage)
  const terminal = occPage.locator('[data-terminal-tab-id]:visible .xterm-helper-textarea').first()
  await occPage.screenshot({ path: testInfo.outputPath('wake-focus.png') })
  await expect(terminal).toBeFocused()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  await occPage.keyboard.type('echo WAKE_KEYBOARD_OK')
  await occPage.keyboard.press('Enter')
  await waitForTerminalOutput(occPage, 'WAKE_KEYBOARD_OK')
  await occPage.screenshot({ path: testInfo.outputPath('wake-typing.png') })
})
