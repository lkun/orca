// A fresh profile may have no automation history; Runs navigation and its empty state must still work.

import { test, expect } from './helpers/occ-app'
import { waitForSessionReady } from './helpers/store'

test('opens the runs dashboard and returns to automations', async ({ occPage }) => {
  await waitForSessionReady(occPage)

  await occPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openAutomationsPage()
  })

  const runsButton = occPage.getByRole('button', { name: 'Runs' })
  await expect(runsButton).toBeVisible()
  await runsButton.click()

  await expect(occPage.getByRole('navigation', { name: 'Automations breadcrumb' })).toBeVisible()
  await expect(occPage.getByText('Successful · 24h')).toBeVisible()
  await expect(occPage.getByText('Failed · 24h')).toBeVisible()
  await expect(occPage.getByText('Successful · 7d')).toBeVisible()
  await expect(occPage.getByText('Failed · 7d')).toBeVisible()
  await expect(occPage.getByRole('button', { name: 'Filters' })).toBeVisible()
  await expect(occPage.getByRole('button', { name: 'Refresh runs' })).toBeVisible()
  await expect(occPage.getByText('Automation', { exact: true })).toBeVisible()
  await expect(occPage.getByText('Triggered', { exact: true })).toBeVisible()
  await expect(occPage.getByText('Status', { exact: true })).toBeVisible()

  await occPage
    .getByRole('navigation', { name: 'Automations breadcrumb' })
    .getByRole('button', { name: 'Automations' })
    .click()
  await expect(occPage.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(runsButton).toBeVisible()
})
