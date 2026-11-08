/**
 * Invariant: one dev plugin folder failing (deleted, recreated, removed from settings) never
 * reloads another dev plugin's open panel, while an edit in the healthy folder still reloads it once.
 * On macOS the recreated folder is found by the 60-second maintenance check, so this spans two ticks.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'
import {
  evalInGuest,
  ISOLATED_FRAMES_E2E,
  pluginGuest,
  waitForGuestReady
} from './helpers/plugin-frame-guest'

test.use(ISOLATED_FRAMES_E2E)

const HEALTHY_TITLE = 'Hello OCC'
const BROKEN_ID = 'hello-occ-broken'

async function copyPlugin(target: string, id?: string): Promise<void> {
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-occ'), target, { recursive: true })
  if (id) {
    const manifestPath = join(target, 'occ-plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.id = id
    manifest.name = 'Broken OCC'
    manifest.contributes.panels[0].title = 'Broken OCC'
    await writeFile(manifestPath, JSON.stringify(manifest))
  }
}

function listsBrokenPlugin(page: Page): Promise<boolean> {
  return page.evaluate(
    async (id) => (await window.api.plugins.list()).some((p) => p.pluginKey.endsWith(`.${id}`)),
    BROKEN_ID
  )
}

/**
 * Why count restarts: a loaded host can restart the shared watcher process (delivery canary); every
 * subscriber, healthy or not, then catches up once by design. Those reloads are not root coupling.
 */
function countWatcherProcessRestarts(app: ElectronApplication): () => number {
  let restarts = 0
  app.process().stderr?.on('data', (chunk: Buffer) => {
    restarts += String(chunk).match(/watcher process crashed; resubscribing/g)?.length ?? 0
  })
  return () => restarts
}

/** Every distinct guest load of the healthy panel (a new webview element or a new URL). */
async function healthyLoadLog(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => document.documentElement.dataset.e2eHealthyLoads ?? '[]')
  const loads: unknown = JSON.parse(raw)
  return Array.isArray(loads) ? loads.map(String) : []
}

async function healthyLoads(page: Page): Promise<number> {
  return (await healthyLoadLog(page)).length
}

function readHeading(page: Page): Promise<string | null> {
  return evalInGuest<string | null>(
    pluginGuest(page, HEALTHY_TITLE),
    `document.querySelector('h1')?.textContent ?? null`
  ).catch(() => null)
}

test('a failing dev folder does not reload another dev plugin panel', async ({
  electronApp,
  occPage
}) => {
  // Why 7 minutes: two 60-second maintenance ticks plus slow FSEvents delivery on loaded hosts.
  test.setTimeout(7 * 60_000)
  const watcherRestarts = countWatcherProcessRestarts(electronApp)
  const tempRoot = await mkdtemp(join(tmpdir(), 'occ-dev-root-isolation-'))
  const healthy = join(tempRoot, 'healthy')
  const broken = join(tempRoot, 'broken')
  try {
    await copyPlugin(healthy)
    await copyPlugin(broken, BROKEN_ID)
    await enableDevPlugins(occPage, [healthy, broken])
    await expect.poll(() => listsBrokenPlugin(occPage)).toBe(true)

    await occPage.evaluate(() => {
      const state = window.__store?.getState()
      if (state && !state.rightSidebarOpen) {
        state.toggleRightSidebar()
      }
    })
    const panelButton = occPage.getByRole('button', { name: HEALTHY_TITLE, exact: true })
    await expect(panelButton).toBeVisible({ timeout: 15_000 })
    await panelButton.click()
    await waitForGuestReady(pluginGuest(occPage, HEALTHY_TITLE))
    await expect.poll(() => readHeading(occPage)).toBe('Hello OCC 👋')

    await occPage.evaluate((title) => {
      const seen = new WeakMap<Element, string>()
      const loads: string[] = []
      setInterval(() => {
        const webview = document.querySelector<Electron.WebviewTag>(`webview[title="${title}"]`)
        let url = ''
        try {
          url = webview?.getURL() ?? ''
        } catch {
          return
        }
        if (webview && url && seen.get(webview) !== url) {
          seen.set(webview, url)
          loads.push(`${url} @${Date.now()}`)
          document.documentElement.dataset.e2eHealthyLoads = JSON.stringify(loads)
        }
      }, 50)
    }, HEALTHY_TITLE)
    await expect.poll(() => healthyLoads(occPage)).toBe(1)
    // Why a warm-up edit: FSEvents can hold the copy's create events and flush them with the next
    // change, which would look like a coupled reload. One real edit drains them first.
    await writeFile(join(healthy, 'warm-up.txt'), 'x')
    await expect.poll(() => healthyLoads(occPage), { timeout: 60_000 }).toBeGreaterThan(1)
    // ast-grep-ignore: test-no-real-time-wait -- the warm-up batch must finish before the baseline
    await occPage.waitForTimeout(2_000)
    const baselineLoads = await healthyLoads(occPage)
    const restartsBefore = watcherRestarts()
    const expectNoCoupledReloads = async (): Promise<void> => {
      const loads = await healthyLoadLog(occPage)
      expect(loads.length, JSON.stringify(loads)).toBeLessThanOrEqual(
        baselineLoads + watcherRestarts() - restartsBefore
      )
    }

    // The broken folder disappears, then comes back; each change refreshes only its own watcher.
    await rm(broken, { recursive: true, force: true })
    await expect.poll(() => listsBrokenPlugin(occPage), { timeout: 90_000 }).toBe(false)
    await expectNoCoupledReloads()
    await copyPlugin(broken, BROKEN_ID)
    await expect.poll(() => listsBrokenPlugin(occPage), { timeout: 90_000 }).toBe(true)
    await expectNoCoupledReloads()
    // Another full maintenance tick with both folders present stays quiet.
    // ast-grep-ignore: test-no-real-time-wait -- the claim is that a real maintenance tick stays quiet
    await occPage.waitForTimeout(62_000)
    await expectNoCoupledReloads()
    // Dropping the broken folder from settings retires only its watcher.
    await occPage.evaluate(
      async (devPluginPaths) => {
        const settings = await window.api.settings.set({ devPluginPaths })
        window.__store?.setState({ settings })
        await window.api.plugins.refresh()
      },
      [healthy]
    )
    await expect.poll(() => listsBrokenPlugin(occPage)).toBe(false)
    // ast-grep-ignore: test-no-real-time-wait -- the claim is that no reload follows the removal
    await occPage.waitForTimeout(1_500)
    await expectNoCoupledReloads()

    // A real edit in the healthy folder still reloads its panel, exactly once.
    const loadsBeforeEdit = await healthyLoads(occPage)
    const restartsBeforeEdit = watcherRestarts()
    const panelPath = join(healthy, 'panel.html')
    const html = await readFile(panelPath, 'utf8')
    await writeFile(panelPath, html.replace('Hello OCC 👋', 'Hello OCC reloaded'))
    await expect.poll(() => readHeading(occPage), { timeout: 60_000 }).toBe('Hello OCC reloaded')
    // ast-grep-ignore: test-no-real-time-wait -- the claim is that the edit reloads only once
    await occPage.waitForTimeout(2_000)
    expect(await healthyLoads(occPage)).toBeGreaterThan(loadsBeforeEdit)
    expect(await healthyLoads(occPage)).toBeLessThanOrEqual(
      loadsBeforeEdit + 1 + watcherRestarts() - restartsBeforeEdit
    )
  } finally {
    await disablePluginSystem(occPage).catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
