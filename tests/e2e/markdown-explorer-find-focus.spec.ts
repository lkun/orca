import { expect, test } from './helpers/occ-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  occPage
}) => {
  await waitForSessionReady(occPage)
  await waitForActiveWorktree(occPage)
  await openFileExplorer(occPage)

  const readmeRow = occPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(occPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(occPage, 'f')

  await expect(
    occPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
