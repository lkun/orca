import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { expect, test } from './helpers/occ-app'

test.use({ seedTestRepo: false })

test('shows one delayed-save notice, restores it after reload, and clears on recovery', async ({
  electronApp,
  occPage
}, testInfo) => {
  expect(await occPage.evaluate(() => window.api.app.isProfileStateSaveDelayed())).toBe(false)

  const setSaveDelayed = async (delayed: boolean): Promise<void> => {
    // Simulate the writer's status without stalling the app or touching real profile data.
    await retryTransientMainEvaluate(() =>
      electronApp.evaluate(({ ipcMain }, value) => {
        ipcMain.removeHandler('app:isProfileStateSaveDelayed')
        ipcMain.handle('app:isProfileStateSaveDelayed', () => value)
      }, delayed)
    )
    const window = await electronApp.browserWindow(occPage)
    await window.evaluate((browserWindow, value) => {
      browserWindow.webContents.send('app:profileStateSaveDelayChanged', value)
    }, delayed)
    await window.dispose()
  }

  const notice = occPage.locator('[data-sonner-toast]').filter({
    hasText: 'Profile storage is taking longer than usual'
  })
  await setSaveDelayed(true)
  await expect(notice).toHaveCount(1)
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Further saves may be delayed while this operation finishes.')
  // The app toaster's close button is the only control; the notice has no action button.
  await expect(notice.getByRole('button')).toHaveAttribute('data-close-button')
  await expect(notice).toHaveCSS('opacity', '1')
  const screenshot = testInfo.outputPath('delayed-save-notice.png')
  await occPage.screenshot({ path: screenshot })
  await testInfo.attach('delayed-save-notice', { path: screenshot, contentType: 'image/png' })

  await setSaveDelayed(true)
  await expect(notice).toHaveCount(1)

  await occPage.clock.install()
  await occPage.clock.pauseAt(await occPage.evaluate(() => Date.now() + 1_000))
  try {
    // Hold dismissal frames until the replacement warning has been published.
    await setSaveDelayed(false)
    await setSaveDelayed(true)
    await setSaveDelayed(true)
    await occPage.clock.runFor(50)
    await expect(notice.and(occPage.locator('[data-removed="true"]'))).toHaveCount(1)
    await occPage.clock.runFor(400)
    await expect(notice).toHaveCount(1)
    await expect(notice).toBeVisible()
  } finally {
    await occPage.clock.resume()
  }

  await occPage.reload()
  await expect(notice).toBeVisible()
  expect(await occPage.evaluate(() => window.api.app.isProfileStateSaveDelayed())).toBe(true)

  await setSaveDelayed(false)
  await expect(notice).toHaveCount(0)
})
