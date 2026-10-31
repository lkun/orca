import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/occ-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const relativeFilePath =
  'packages/occ/src/renderer/src/components/navigation/worktree/quick-open/long-path-fixtures/very-deeply-nested-folder/QuickOpenTarget.tsx'

test('cmd+p quick open prioritizes the filename and reveals the full path on hover', async ({
  electronApp,
  occPage,
  testRepoPath
}) => {
  const filePath = path.join(testRepoPath, ...relativeFilePath.split('/'))
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'export const QuickOpenTarget = true\n')

  await waitForSessionReady(occPage)
  await waitForActiveWorktree(occPage)
  await ensureTerminalVisible(occPage)

  // Headless Playwright keyboard events bypass Electron’s before-input-event shortcut path.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('ui:openQuickOpen')
  })
  const dialog = occPage.getByRole('dialog', { name: 'Go to file' })
  await expect(dialog).toBeVisible()
  const inputBox = await dialog.locator('[data-cmdk-input-wrapper]').boundingBox()
  expect(inputBox).not.toBeNull()
  expect(inputBox!.height).toBeLessThanOrEqual(45)
  const input = dialog.locator('input[placeholder="Go to file..."]')
  await input.fill('QuickOpenTarget')

  const row = dialog.getByRole('option').filter({ hasText: 'QuickOpenTarget.tsx' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('packages/occ/src/renderer/src/components/navigation/')
  const rowBox = await row.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(rowBox!.height).toBeLessThanOrEqual(29)
  const rowText = await row.textContent()
  expect(rowText?.indexOf('QuickOpenTarget.tsx')).toBeLessThan(
    rowText?.indexOf('packages/occ/src/renderer/src/components/navigation/') ?? -1
  )

  const tooltip = occPage
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: relativeFilePath })
  // Streaming remounts rows under the pointer; clear prior tooltips before retrying hover.
  await expect(async () => {
    await occPage.mouse.move(8, 8)
    const currentRow = dialog.getByRole('option').filter({ hasText: 'QuickOpenTarget.tsx' }).first()
    await expect(currentRow).toBeVisible()
    const currentBox = await currentRow.boundingBox()
    if (!currentBox) {
      throw new Error('Quick Open result remounted before hover')
    }
    await occPage.mouse.move(currentBox.x + 20, currentBox.y + 12)
    await occPage.mouse.move(currentBox.x + 40, currentBox.y + 12)
    await expect(tooltip).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000, intervals: [100, 250, 500] })

  // Pin exact offsets in cursorTooltipOffsets units; E2E proves the full-path tooltip opens without measuring mid-reflow geometry.
  await expect(tooltip).toBeVisible()

  const proofPath = process.env.OCC_QUICK_OPEN_PROOF_PATH
  if (proofPath) {
    await occPage.screenshot({ path: proofPath })
  }
})
