import { test, expect } from './helpers/occ-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('terminal search counts real matches and repeat find selects the query', async ({
  occPage
}, testInfo) => {
  await waitForSessionReady(occPage)
  await waitForActiveWorktree(occPage)
  await ensureTerminalVisible(occPage)
  await waitForActiveTerminalManager(occPage, 30_000)
  const ptyId = await waitForActivePanePtyId(occPage)
  for (let line = 0; line < 3; line++) {
    await execInTerminal(occPage, ptyId, 'echo occ-search-proof')
  }
  await expect
    .poll(
      async () =>
        (await getTerminalContent(occPage))
          .split(/\r?\n/)
          .filter((line) => line.trim() === 'occ-search-proof').length
    )
    .toBe(3)
  await focusActiveTerminalInput(occPage)
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await occPage.keyboard.press(`${modifier}+f`)
  const search = occPage.locator('[data-terminal-search-root]')
  const input = search.locator('input')
  await expect(input).toBeFocused()
  await search.getByTitle('Regex', { exact: true }).click()
  const query = '^occ-search-proof$'
  await input.fill(query)
  await expect(search).toContainText(/[1-3]\/3/)
  const initialCount = await search.innerText()
  await input.press('Enter')
  await expect.poll(() => search.innerText()).not.toBe(initialCount)
  await occPage.screenshot({ path: testInfo.outputPath('search-results.png') })
  await input.press('ArrowLeft')
  await occPage.keyboard.press(`${modifier}+f`)
  await expect(input).toBeFocused()
  await expect
    .poll(() =>
      input.evaluate((element) =>
        element instanceof HTMLInputElement
          ? { start: element.selectionStart, end: element.selectionEnd }
          : null
      )
    )
    .toEqual({ start: 0, end: query.length })
  await occPage.screenshot({ path: testInfo.outputPath('search-query-selected.png') })
  await input.fill('no-such-search-result-314159')
  await expect(search).toContainText('No results')
  await input.press('Escape')
  await expect(search).toBeHidden()
})
