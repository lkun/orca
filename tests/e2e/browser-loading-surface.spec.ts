import { expect, test } from './helpers/occ-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { crashGuestRenderer } from './browser-guest-runtime-oracle'
import { observeBrowserLoadingSurface } from './browser-loading-surface-oracle'

test('browser host follows the theme before content and preserves the webpage canvas', async ({
  occPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(occPage)
  await ensureTerminalVisible(occPage)
  await waitForActiveWorktree(occPage)
  const observations = await observeBrowserLoadingSurface(
    occPage,
    (name) => testInfo.outputPath(name),
    async (id) => {
      await crashGuestRenderer(electronApp, id)
    }
  )
  expect(observations.filter((entry) => !entry.pass)).toEqual([])
})
