// Require stable split-leaf UUIDs across PTY binding, OCC_PANE_KEY and context menu.

import { test, expect } from './helpers/occ-app'
import {
  UUID_RE,
  discoverActivePtyId,
  execInTerminal,
  countVisibleTerminalPanes,
  splitActiveTerminalPane,
  waitForPaneIdentitySnapshot,
  waitForTerminalOutput,
  waitForPaneCount
} from './helpers/terminal'
import { openTerminalContextMenu } from './helpers/terminal-pane-title-actions'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('can split terminal pane right', async ({ occPage }) => {
    const paneCountBefore = await countVisibleTerminalPanes(occPage)

    await splitActiveTerminalPane(occPage, 'vertical')
    await waitForPaneCount(occPage, paneCountBefore + 1)

    const paneCountAfter = await countVisibleTerminalPanes(occPage)
    expect(paneCountAfter).toBe(paneCountBefore + 1)
  })

  test('can split terminal pane down', async ({ occPage }) => {
    const paneCountBefore = await countVisibleTerminalPanes(occPage)

    await splitActiveTerminalPane(occPage, 'horizontal')
    await waitForPaneCount(occPage, paneCountBefore + 1)

    const paneCountAfter = await countVisibleTerminalPanes(occPage)
    expect(paneCountAfter).toBe(paneCountBefore + 1)
  })

  test('split panes persist PTY bindings by stable UUID leaf id', async ({ occPage }) => {
    const paneCountBefore = await countVisibleTerminalPanes(occPage)

    await splitActiveTerminalPane(occPage, 'vertical')
    await waitForPaneCount(occPage, paneCountBefore + 1)

    const snapshot = await waitForPaneIdentitySnapshot(occPage, paneCountBefore + 1)
    const leafIds = snapshot.panes.map((pane) => pane.leafId)
    const ptyIds = snapshot.panes.map((pane) => pane.ptyId)

    expect(new Set(leafIds).size).toBe(leafIds.length)
    expect(new Set(ptyIds).size).toBe(ptyIds.length)
    expect(Object.keys(snapshot.ptyIdsByLeafId).sort()).toEqual([...leafIds].sort())
    expect(Object.keys(snapshot.ptyIdsByLeafId).every((leafId) => UUID_RE.test(leafId))).toBe(true)
    expect(
      snapshot.panes.some(
        (pane) =>
          String(pane.numericPaneId) === pane.leafId || `pane:${pane.numericPaneId}` === pane.leafId
      )
    ).toBe(false)
  })

  test('terminal process receives OCC_PANE_KEY with the active UUID leaf id', async ({
    occPage
  }) => {
    const snapshot = await waitForPaneIdentitySnapshot(occPage, 1)
    const activeLeafId = snapshot.activeLeafId ?? snapshot.panes[0]?.leafId
    if (!activeLeafId) {
      throw new Error('No active pane leaf id found')
    }

    const expectedPaneKey = `${snapshot.tabId}:${activeLeafId}`
    const ptyId = await discoverActivePtyId(occPage)
    const marker = `OCC_PANE_KEY_E2E_${Date.now()}`

    await execInTerminal(occPage, ptyId, `printf '${marker}=%s\\n' "$OCC_PANE_KEY"`)
    await waitForTerminalOutput(occPage, `${marker}=${expectedPaneKey}`)

    expect(activeLeafId).toMatch(UUID_RE)
  })

  test('terminal context menu copies the stable pane ID', async ({ occPage }) => {
    const snapshot = await waitForPaneIdentitySnapshot(occPage, 1)
    const leafId = snapshot.panes[0]?.leafId
    if (!leafId) {
      throw new Error('No terminal pane leaf id found')
    }
    const expectedPaneKey = `${snapshot.tabId}:${leafId}`

    await openTerminalContextMenu(occPage)
    await occPage.getByText('Copy Pane ID', { exact: true }).click()

    await expect
      .poll(() => occPage.evaluate(() => window.api.ui.readClipboardText()), { timeout: 3_000 })
      .toBe(expectedPaneKey)
    await expect(occPage.getByText('Pane ID copied', { exact: true })).toBeVisible()
    expect(leafId).toMatch(UUID_RE)
  })
})
