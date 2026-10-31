import { test, expect } from './helpers/occ-app'

test.use({ dismissOnboarding: false, seedTestRepo: false })

test('Retry recovers a rejected language catalog request without reloading', async ({
  electronApp,
  occPage
}, testInfo) => {
  await occPage.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Renderer store unavailable')
    }
    const settings = await window.api.settings.get()
    if (!settings.telemetry) {
      throw new Error('Telemetry settings unavailable')
    }
    await store.getState().updateSettingsOrThrow({
      uiLanguage: 'en',
      telemetry: { ...settings.telemetry, onboardingLanguageCohort: 'treatment' }
    })
  })
  await occPage.getByRole('button', { name: 'Switch language' }).click()
  await expect(occPage.getByRole('radio', { name: '日本語', exact: true })).toBeVisible()

  await electronApp.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /\/ja-[^/]+\.(?:json|js)(?:\?|$)/.test(details.url) })
    })
  })
  const timeOrigin = await occPage.evaluate(() => performance.timeOrigin)
  const rejected = occPage.waitForEvent('requestfailed', {
    predicate: (request) => /\/ja-[^/]+\.(?:json|js)(?:\?|$)/.test(request.url())
  })
  await occPage.getByRole('radio', { name: '日本語', exact: true }).click()
  const failedRequest = await rejected
  await expect(occPage.getByRole('alert')).toContainText('Could not load this language')
  await expect(occPage.getByRole('radio', { name: 'English', exact: true })).toBeChecked()
  await occPage.screenshot({ path: testInfo.outputPath('catalog-request-rejected.png') })

  await electronApp.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest(null)
  })
  expect(
    await occPage.evaluate(async (url) => (await fetch(url)).status, failedRequest.url())
  ).toBe(200)
  await occPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(occPage.getByRole('radio', { name: '日本語', exact: true })).toBeChecked()
  await expect(occPage.getByRole('radiogroup', { name: '表示言語', exact: true })).toBeVisible()
  await expect(occPage.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(() => occPage.evaluate(() => window.api.settings.get().then((s) => s.uiLanguage)))
    .toBe('ja')
  expect(await occPage.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await occPage.screenshot({ path: testInfo.outputPath('catalog-retry-recovered.png') })
})
