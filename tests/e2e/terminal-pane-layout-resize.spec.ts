// Require pane geometry to change after a divider drag.

import { test, expect } from './helpers/occ-app'
import {
  countVisibleTerminalPanes,
  splitActiveTerminalPane,
  waitForPaneCount
} from './helpers/terminal'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  // Real pointer capture needs a valid pointing-device id, unreliable in hidden Electron.
  // Run OCC_BACKGROUND_LAUNCH=1 OCC_E2E_HEADFUL=1 pnpm run test:e2e only on an isolated display or CI.
  test('@headful can resize terminal panes by real mouse drag', async ({ occPage }) => {
    const panesBefore = await countVisibleTerminalPanes(occPage)
    await splitActiveTerminalPane(occPage, 'vertical')
    await waitForPaneCount(occPage, panesBefore + 1)

    const paneWidthsBefore = await occPage.evaluate(() => {
      const xterms = document.querySelectorAll('.xterm')
      return Array.from(xterms)
        .filter((x) => (x as HTMLElement).offsetParent !== null)
        .map((x) => (x as HTMLElement).getBoundingClientRect().width)
    })
    expect(paneWidthsBefore.length).toBeGreaterThanOrEqual(2)

    const divider = occPage.locator('.pane-divider.is-vertical').first()
    await expect(divider).toBeVisible({ timeout: 3_000 })
    const box = await divider.boundingBox()
    expect(box).not.toBeNull()

    const startX = box!.x + box!.width / 2
    const startY = box!.y + box!.height / 2
    await occPage.mouse.move(startX, startY)
    await occPage.mouse.down()
    await occPage.mouse.move(startX + 150, startY, { steps: 20 })
    await occPage.mouse.up()

    await expect
      .poll(
        async () => {
          const widthsAfter = await occPage.evaluate(() => {
            const xterms = document.querySelectorAll('.xterm')
            return Array.from(xterms)
              .filter((x) => (x as HTMLElement).offsetParent !== null)
              .map((x) => (x as HTMLElement).getBoundingClientRect().width)
          })
          if (widthsAfter.length < 2) {
            return false
          }

          return paneWidthsBefore.some((w, i) => Math.abs(w - widthsAfter[i]) > 20)
        },
        { timeout: 5_000, message: 'Pane widths did not change after dragging divider' }
      )
      .toBe(true)
  })
})
