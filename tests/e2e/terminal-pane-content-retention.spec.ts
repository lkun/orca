// Require scrollback retention across tab, pane and worktree changes.

import { test, expect } from './helpers/occ-app'
import {
  discoverActivePtyId,
  execInTerminal,
  closeActiveTerminalPane,
  countVisibleTerminalPanes,
  focusLastTerminalPane,
  splitActiveTerminalPane,
  waitForTerminalOutput,
  waitForPaneCount,
  getTerminalContent
} from './helpers/terminal'
import {
  getActiveWorktreeId,
  getActiveTabType,
  getWorktreeTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('terminal pane retains content when switching tabs and back', async ({ occPage }) => {
    const ptyId = await discoverActivePtyId(occPage)
    const marker = `RETAIN_TEST_${Date.now()}`
    await execInTerminal(occPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(occPage, marker)

    const worktreeId = (await getActiveWorktreeId(occPage))!
    await pressShortcut(occPage, 't')

    await expect
      .poll(async () => (await getWorktreeTabs(occPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)

    const activeType = await getActiveTabType(occPage)
    expect(activeType).toBe('terminal')

    await pressShortcut(occPage, 'BracketLeft', { shift: true })

    await expect
      .poll(async () => (await getTerminalContent(occPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)

    await pressShortcut(occPage, 'BracketRight', { shift: true })
    await pressShortcut(occPage, 'w')
  })

  test('terminal pane retains content when splitting and closing a pane', async ({ occPage }) => {
    const ptyId = await discoverActivePtyId(occPage)
    const marker = `SPLIT_RETAIN_${Date.now()}`
    await execInTerminal(occPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(occPage, marker)

    const panesBefore = await countVisibleTerminalPanes(occPage)

    await splitActiveTerminalPane(occPage, 'vertical')
    await waitForPaneCount(occPage, panesBefore + 1)

    await focusLastTerminalPane(occPage)
    await closeActiveTerminalPane(occPage)
    await waitForPaneCount(occPage, panesBefore)

    await expect
      .poll(async () => (await getTerminalContent(occPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)
  })

  test('terminal pane retains content when switching worktrees and back', async ({ occPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(occPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
      return
    }

    const worktreeId = (await getActiveWorktreeId(occPage))!

    const ptyId = await discoverActivePtyId(occPage)
    const marker = `WT_RETAIN_${Date.now()}`
    await execInTerminal(occPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(occPage, marker)

    const otherId = await switchToOtherWorktree(occPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(occPage), { timeout: 5_000 }).toBe(otherId)

    await switchToWorktree(occPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(occPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Poll the retained marker after worktree return: serialize-addon rebind can lag the activation cascade, so avoid an earlier manager-timing assertion.
    await ensureTerminalVisible(occPage)

    await expect
      .poll(async () => (await getTerminalContent(occPage)).includes(marker), { timeout: 20_000 })
      .toBe(true)
  })
})
