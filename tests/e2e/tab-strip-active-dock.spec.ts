// Require real Chromium sticky layout to dock an overflowed active tab and reveal arrivals without scrolling/flicker; mocked unit geometry cannot prove the drawn dock.

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/occ-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'

const STRIP = '.terminal-tab-strip'

type DockSample = { scrollLeft: number; activeLeft: number; activeRight: number }

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __tabStripDockSamples?: DockSample[]
  }
}

function slotSelector(tabId: string): string {
  return `${STRIP} > [data-tab-strip-slot="${tabId}"]`
}

async function createBackgroundTerminalTab(page: Page, worktreeId: string): Promise<string> {
  return page.evaluate(
    (wId) =>
      window.__store!.getState().createTab(wId, undefined, undefined, { activate: false }).id,
    worktreeId
  )
}

async function readStripSlotIds(page: Page): Promise<string[]> {
  return page.$$eval(`${STRIP} > [data-tab-strip-slot]`, (nodes) =>
    nodes.map((node) => node.getAttribute('data-tab-strip-slot') ?? '')
  )
}

/** Where `tabId` is drawn relative to the strip's visible viewport, in px. */
async function readSlotViewportSpan(
  page: Page,
  tabId: string
): Promise<{ left: number; right: number; viewLeft: number; viewRight: number }> {
  return page.evaluate(
    ({ strip, slot }) => {
      const stripEl = document.querySelector<HTMLElement>(strip)!
      const slotRect = document.querySelector<HTMLElement>(slot)!.getBoundingClientRect()
      const viewLeft = stripEl.getBoundingClientRect().left + stripEl.clientLeft
      return {
        left: slotRect.left,
        right: slotRect.right,
        viewLeft,
        viewRight: viewLeft + stripEl.clientWidth
      }
    },
    { strip: STRIP, slot: slotSelector(tabId) }
  )
}

async function isSlotInView(page: Page, tabId: string): Promise<boolean> {
  const span = await readSlotViewportSpan(page, tabId)
  return span.left >= span.viewLeft - 1 && span.right <= span.viewRight + 1
}

async function nextFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame)
    }
  }, count)
}

test.describe('Tab strip active-tab dock', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
  })

  for (const edge of ['start', 'end'] as const) {
    test(`keeps inactive tabs clickable in a strip too narrow for the ${edge} dock`, async ({
      occPage
    }) => {
      const worktreeId = await waitForActiveWorktree(occPage)
      for (let i = 0; i < 3; i++) {
        await createBackgroundTerminalTab(occPage, worktreeId)
      }
      const ids = await readStripSlotIds(occPage)
      const activeTabId = (edge === 'start' ? ids.at(0) : ids.at(-1))!
      const inactiveTabId = (edge === 'start' ? ids.at(-1) : ids.at(0))!
      const activeTab = occPage.locator(
        `${slotSelector(activeTabId)} [data-testid="sortable-tab"]`
      )
      const inactiveTab = occPage.locator(
        `${slotSelector(inactiveTabId)} [data-testid="sortable-tab"]`
      )
      await activeTab.click()

      const strip = occPage.locator(STRIP).first()
      await strip.evaluate((el) => {
        el.style.maxWidth = '100px'
      })
      await expect(strip).toHaveAttribute('data-active-tab-dock-disabled', '')
      await strip.evaluate((el, side) => {
        el.scrollLeft = side === 'start' ? el.scrollWidth : 0
      }, edge)
      await expect.poll(() => isSlotInView(occPage, inactiveTabId)).toBe(true)
      await inactiveTab.click()
      await expect(inactiveTab).toHaveAttribute('data-active', 'true')
      await activeTab.locator('[data-tab-close-button]').click()
      await expect(activeTab).toHaveCount(0)

      await strip.evaluate((el) => {
        el.style.maxWidth = '200px'
      })
      await expect(strip).not.toHaveAttribute('data-active-tab-dock-disabled')
      await strip.evaluate((el, side) => {
        el.scrollLeft = side === 'start' ? 0 : el.scrollWidth
      }, edge)
      await expect(strip).toHaveAttribute(
        'data-active-tab-docked',
        edge === 'start' ? 'end' : 'start'
      )
      expect(await isSlotInView(occPage, inactiveTabId)).toBe(true)
    })
  }

  test('keeps inactive tabs clickable after cancelling a drag that scrolled a narrow strip', async ({
    occPage
  }) => {
    const worktreeId = await waitForActiveWorktree(occPage)
    for (let i = 0; i < 3; i++) {
      await createBackgroundTerminalTab(occPage, worktreeId)
    }
    const ids = await readStripSlotIds(occPage)
    const activeSlot = occPage.locator(slotSelector(ids[0]))
    const activeTab = activeSlot.locator('[data-testid="sortable-tab"]')
    const inactiveTab = occPage.locator(`${slotSelector(ids[1])} [data-testid="sortable-tab"]`)
    await activeTab.click()

    const strip = occPage.locator(STRIP).first()
    await strip.evaluate((el) => {
      el.style.maxWidth = '100px'
    })
    await expect(strip).toHaveAttribute('data-active-tab-dock-disabled', '')
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    await expect.poll(() => isSlotInView(occPage, ids[0])).toBe(true)

    const box = (await activeTab.boundingBox())!
    const y = box.y + box.height / 2
    await occPage.mouse.move(box.x + 20, y)
    await occPage.mouse.down()
    await occPage.mouse.move(box.x + 34, y)
    await occPage.mouse.move(box.x + 38, y)
    await expect(strip.locator('[data-active-tab-dock]')).toHaveCount(0)

    // Hidden-window drag overlays can intercept native wheel input before it reaches the strip.
    await strip.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 72, cancelable: true }))
    })
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBe(72)
    await nextFrames(occPage, 2)
    await occPage.evaluate(() => window.dispatchEvent(new Event('blur')))
    await occPage.mouse.up()

    await expect(activeSlot).toHaveAttribute('data-active-tab-dock', '')
    await expect(strip).toHaveAttribute('data-active-tab-dock-disabled', '')
    await inactiveTab.click()
    await expect(inactiveTab).toHaveAttribute('data-active', 'true')
  })

  test('docks an offscreen active tab and reveals an arriving tab beside it without flicker', async ({
    occPage
  }) => {
    const worktreeId = await waitForActiveWorktree(occPage)
    const strip = occPage.locator(STRIP).first()
    await expect(strip).toBeVisible()

    for (let i = 0; i < 40; i++) {
      const overflowsTwice = await strip.evaluate((el) => el.scrollWidth > el.clientWidth * 2)
      if (overflowsTwice) {
        break
      }
      await createBackgroundTerminalTab(occPage, worktreeId)
      await nextFrames(occPage, 1)
    }
    await expect
      .poll(() => strip.evaluate((el) => el.scrollWidth > el.clientWidth * 2), { timeout: 5_000 })
      .toBe(true)

    const lastTabId = (await readStripSlotIds(occPage)).at(-1)!
    await occPage.locator(`${slotSelector(lastTabId)} [data-testid="sortable-tab"]`).click()
    await expect(occPage.locator(`${slotSelector(lastTabId)} [data-active="true"]`)).toHaveCount(1)

    // Scroll the active last tab's real spot far out of view; sticky layout must hold it at the end.
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    await expect(strip).toHaveAttribute('data-active-tab-docked', 'end')
    const docked = await readSlotViewportSpan(occPage, lastTabId)
    expect(Math.abs(docked.right - docked.viewRight)).toBeLessThanOrEqual(1)

    // Why sample every frame: a smooth scroll or a double jump shows up only between assertions.
    await occPage.evaluate(
      ({ strip: stripSelector, slot }) => {
        const stripEl = document.querySelector<HTMLElement>(stripSelector)!
        const samples: DockSample[] = []
        const sample = (): void => {
          const rect = document.querySelector<HTMLElement>(slot)!.getBoundingClientRect()
          samples.push({
            scrollLeft: stripEl.scrollLeft,
            activeLeft: rect.left,
            activeRight: rect.right
          })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
        window.__tabStripDockSamples = samples
      },
      { strip: STRIP, slot: slotSelector(lastTabId) }
    )

    // The pointer still rests on the strip from the click, so the arriving tab waits for it to leave.
    const arrivingTabId = await createBackgroundTerminalTab(occPage, worktreeId)
    await expect(occPage.locator(slotSelector(arrivingTabId))).toHaveCount(1)
    await nextFrames(occPage, 3)
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0)
    expect(await isSlotInView(occPage, arrivingTabId)).toBe(false)

    const stripBox = (await strip.boundingBox())!
    await occPage.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height + 200)
    await expect.poll(() => isSlotInView(occPage, arrivingTabId), { timeout: 3_000 }).toBe(true)
    expect(await isSlotInView(occPage, lastTabId)).toBe(true)
    await nextFrames(occPage, 3)

    const finalScrollLeft = await strip.evaluate((el) => el.scrollLeft)
    expect(finalScrollLeft).toBeGreaterThan(0)
    const view = await readSlotViewportSpan(occPage, lastTabId)
    const samples = await occPage.evaluate(() => window.__tabStripDockSamples ?? [])
    expect(samples.length).toBeGreaterThan(0)
    for (const sample of samples) {
      // One jump from the docked position to the reveal; any value in between is visible scrolling.
      expect([0, finalScrollLeft]).toContain(sample.scrollLeft)
      expect(sample.activeLeft).toBeGreaterThanOrEqual(view.viewLeft - 1)
      expect(sample.activeRight).toBeLessThanOrEqual(view.viewRight + 1)
    }
  })
})
