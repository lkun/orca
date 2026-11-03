/**
 * Invariant: a declarative panel's module runs in a hidden guest on the plugin's partition, and
 * OCC draws its tree with real OCC DOM: inputs and buttons round-trip through the guest, and
 * the guest still cannot reach the network.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/occ-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'
import {
  evalInGuest,
  pluginGuest,
  waitForGuestReady,
  ISOLATED_FRAMES_E2E
} from './helpers/plugin-frame-guest'

// Isolated frames are off by default; these journeys exercise the guest path.
test.use(ISOLATED_FRAMES_E2E)

const TITLE = 'Hello Components'

test('a declarative panel renders with OCC components and updates on input', async ({
  occPage
}) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '/')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.end('leak')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('leak listener has no port')
  }
  const tempRoot = await mkdtemp(join(tmpdir(), 'occ-declarative-'))
  const pluginRoot = join(tempRoot, 'hello-components')
  try {
    await cp(join(process.cwd(), 'examples', 'plugins', 'hello-components'), pluginRoot, {
      recursive: true
    })
    await enableDevPlugins(occPage, [pluginRoot])
    await occPage.evaluate(async () => {
      const store = window.__store?.getState()
      if (store && !store.rightSidebarOpen) {
        store.toggleRightSidebar()
      }
      await window.api.plugins.refresh()
    })
    const panelButton = occPage.getByRole('button', { name: TITLE })
    await expect(panelButton).toBeVisible({ timeout: 15_000 })
    await panelButton.click()

    // OCC's own DOM, not a frame: the heading, list and controls are in the app document.
    await expect(occPage.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 })
    await expect(occPage.getByText('Build a panel')).toBeVisible()
    await expect(occPage.getByText('1 open')).toBeVisible()
    const guest = pluginGuest(occPage, TITLE)
    await expect(occPage.locator('[inert][aria-hidden="true"] webview')).toHaveCount(1)
    await expect(guest).toHaveAttribute('partition', /^persist:occ-plugin-[0-9a-f]{16}$/)

    await occPage.getByPlaceholder('New task').fill('Ship the guest')
    const add = occPage.getByRole('button', { name: 'Add task' })
    await expect(add).toBeEnabled()
    await add.click()
    await expect(occPage.getByText('Ship the guest')).toBeVisible()
    await expect(occPage.getByText('2 open')).toBeVisible()
    await expect(occPage.getByPlaceholder('New task')).toHaveValue('')

    await waitForGuestReady(guest)
    const leak = await evalInGuest<string>(
      guest,
      `fetch('http://127.0.0.1:${address.port}/leak').then(() => 'escaped', (error) => error.name)`
    )
    expect(leak).toBe('TypeError')
    expect(requests).toEqual([])
  } finally {
    await disablePluginSystem(occPage).catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  }
})
