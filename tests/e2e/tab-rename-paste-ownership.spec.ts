import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/occ-app'
import {
  getActiveTabId,
  getActiveWorktreeId,
  getWorktreeTabs,
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWrites
} from './helpers/terminal-pty-write-spy'
import { waitForActiveTerminalManager } from './helpers/terminal'

function editablePasteChord(): string {
  return process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
}

function countOccurrences(value: string, needle: string): number {
  let count = 0
  let index = value.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = value.indexOf(needle, index + needle.length)
  }
  return count
}

async function getActiveTabTitle(page: Page, worktreeId: string): Promise<string> {
  const activeId = await getActiveTabId(page)
  expect(activeId).not.toBeNull()
  const tabs = await getWorktreeTabs(page, worktreeId)
  const tab = tabs.find((entry) => entry.id === activeId)
  expect(tab).toBeDefined()
  return tab!.title ?? ''
}

function tabLocatorByTitle(page: Page, title: string): ReturnType<Page['locator']> {
  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return page.locator(`[data-testid="sortable-tab"][data-tab-title="${escaped}"]`).first()
}

test.describe('tab rename paste ownership', () => {
  test('keyboard paste into rename textbox does not also write to the active terminal', async ({
    electronApp,
    occPage
  }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)
    await installTerminalPtyWriteSpy(electronApp)

    const worktreeId = (await getActiveWorktreeId(occPage))!
    const originalTitle = await getActiveTabTitle(occPage, worktreeId)
    const renameInput = occPage.getByRole('textbox', {
      name: `Rename tab ${originalTitle}`,
      exact: true
    })

    await tabLocatorByTitle(occPage, originalTitle).dblclick()
    await expect(renameInput).toBeVisible()
    await renameInput.fill('')

    const payload = `OCC_E2E_TEXTBOX_PASTE_${randomUUID()}`
    await occPage.evaluate((text) => window.api.ui.writeClipboardText(text), payload)
    await clearTerminalPtyWriteLog(electronApp)
    await expect(renameInput).toBeFocused()

    await occPage.keyboard.press(editablePasteChord())

    await expect(renameInput).toHaveValue(payload)
    expect(countOccurrences(await renameInput.inputValue(), payload)).toBe(1)
    expect((await readTerminalPtyWrites(electronApp)).join('')).not.toContain(payload)

    await renameInput.press('Escape')
    await expect(tabLocatorByTitle(occPage, originalTitle)).toBeVisible()
  })
})
