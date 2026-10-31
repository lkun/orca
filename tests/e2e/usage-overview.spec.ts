import { test, expect } from './helpers/occ-app'
import { getStoreState, waitForSessionReady } from './helpers/store'

test.describe('usage overview', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
  })

  test('Stats & Usage opens on the combined overview with provider controls', async ({
    occPage
  }) => {
    await occPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsPage()
    })

    await expect
      .poll(async () => getStoreState<string>(occPage, 'activeView'), { timeout: 5_000 })
      .toBe('settings')
    await occPage.getByRole('button', { name: 'Stats & Usage' }).click()
    await expect(occPage.getByRole('heading', { name: 'Usage Analytics' })).toBeVisible()
    const providerDropdown = occPage.getByTestId('usage-provider-select')
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: Overview'
    )
    await expect(occPage.getByTestId('usage-overview-pane')).toBeVisible()
    await expect(occPage.getByRole('heading', { name: 'Usage Overview' })).toBeVisible()
    await expect(occPage.getByRole('heading', { name: 'Providers' })).toBeVisible()
    await expect(occPage.getByRole('button', { name: 'Enable Claude' })).toBeVisible()
    await expect(occPage.getByRole('button', { name: 'Enable Codex' })).toBeVisible()
    await expect(occPage.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible()

    await providerDropdown.click()
    await occPage.getByRole('menuitem', { name: 'Codex', exact: true }).click()
    await expect(occPage.getByRole('heading', { name: 'Codex Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute('aria-label', 'Usage analytics provider: Codex')

    await providerDropdown.click()
    await occPage.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
    await expect(occPage.getByRole('heading', { name: 'OpenCode Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: OpenCode'
    )
  })
})
