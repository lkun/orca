// Drive DOM keydown→capture→policy→transport→IPC for every terminal chord.
// Intercept main pty:write for exact bytes without OS-specific readline; assert action effects through panes/search/buffer.
// Skip platform-only chords where runtime policy would never emit them.

import { test, expect } from './helpers/occ-app'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../src/shared/constants'
import {
  execInTerminal,
  sendToTerminal,
  countVisibleTerminalPanes,
  waitForActiveTerminalManager,
  waitForTerminalOutput,
  waitForPaneCount,
  getTerminalContent,
  waitForActivePanePtyId,
  focusActiveTerminalInput
} from './helpers/terminal'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import {
  clearTerminalPtyWriteLog as clearPtyWriteLog,
  installTerminalPtyWriteSpy as installMainProcessPtyWriteSpy,
  readTerminalPtyWrites as getPtyWrites
} from './helpers/terminal-pty-write-spy'
import {
  armKittyKeyboardFromPty,
  getKittyKeyboardFlags,
  interruptAndExpectEtx
} from './helpers/terminal-kitty-keyboard'

async function setActivePaneForegroundAgent(
  page: Page,
  agent: 'droid' | 'antigravity' | null
): Promise<string> {
  return page.evaluate((agent) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!state || !tabId || !pane) {
      throw new Error('No active terminal pane for foreground-agent setup')
    }
    const paneKey = `${tabId}:${pane.leafId}`
    state.setPaneForegroundAgent(paneKey, {
      agent,
      shellForeground: false,
      // The shortcut only emits CSI-u for a process identity confirmed to
      // belong to this PTY; keep the fixture aligned with that trust gate.
      routingTrusted: agent === 'droid'
    })
    return paneKey
  }, agent)
}

async function focusFloatingTerminal(page: Page): Promise<void> {
  await page
    .locator(
      `[data-floating-terminal-panel][aria-hidden="false"] [data-terminal-tab-id] .xterm-helper-textarea`
    )
    .first()
    .focus()
}

async function seedFloatingTerminalTabSwitchScenario(page: Page): Promise<{
  backgroundFirstTabId: string
  floatingFirstTabId: string
  floatingSecondTabId: string
}> {
  return page.evaluate((floatingWorktreeId) => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const state = store.getState()
    const backgroundWorktreeId = state.activeWorktreeId
    if (!backgroundWorktreeId) {
      throw new Error('No active background worktree')
    }

    const backgroundFirst =
      state.tabsByWorktree[backgroundWorktreeId]?.find(
        (tab) => tab.id === state.activeTabIdByWorktree[backgroundWorktreeId]
      ) ??
      state.tabsByWorktree[backgroundWorktreeId]?.find((tab) => tab.id === state.activeTabId) ??
      state.createTab(backgroundWorktreeId)
    state.createTab(backgroundWorktreeId)
    state.setActiveTab(backgroundFirst.id)
    state.setActiveTabType('terminal', window.__store?.getState().activeWorktreeId ?? null)

    const floatingFirst = state.createTab(floatingWorktreeId, undefined, undefined, {
      activate: false
    })
    state.activateTab(floatingFirst.id)
    const floatingGroupId =
      state.activeGroupIdByWorktree[floatingWorktreeId] ??
      state.groupsByWorktree[floatingWorktreeId]?.[0]?.id
    const floatingSecond = state.createTab(floatingWorktreeId, floatingGroupId, undefined, {
      activate: false
    })
    state.activateTab(floatingFirst.id)

    return {
      backgroundFirstTabId: backgroundFirst.id,
      floatingFirstTabId: floatingFirst.id,
      floatingSecondTabId: floatingSecond.id
    }
  }, FLOATING_TERMINAL_WORKTREE_ID)
}

async function getActiveFloatingTerminalTabId(page: Page): Promise<string | null> {
  return page.evaluate((floatingWorktreeId) => {
    const state = window.__store?.getState()
    if (!state) {
      return null
    }
    const groupId = state.activeGroupIdByWorktree[floatingWorktreeId]
    const group =
      (groupId
        ? state.groupsByWorktree[floatingWorktreeId]?.find((candidate) => candidate.id === groupId)
        : null) ??
      state.groupsByWorktree[floatingWorktreeId]?.find((candidate) => candidate.activeTabId) ??
      null
    const activeTab = group?.activeTabId
      ? state.unifiedTabsByWorktree[floatingWorktreeId]?.find((tab) => tab.id === group.activeTabId)
      : null
    return activeTab?.contentType === 'terminal' ? activeTab.entityId : null
  }, FLOATING_TERMINAL_WORKTREE_ID)
}

async function getActiveBackgroundTerminalTabId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    return worktreeId ? (state.activeTabIdByWorktree[worktreeId] ?? state.activeTabId) : null
  })
}

async function getActiveTerminalViewport(
  page: Page
): Promise<{ viewportY: number; baseY: number }> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const buffer = pane?.terminal.buffer.active
    if (!buffer) {
      throw new Error('No active terminal buffer')
    }
    return {
      viewportY: buffer.viewportY,
      baseY: buffer.baseY
    }
  })
}

async function pressAndExpectWrite(
  page: Page,
  app: ElectronApplication,
  chord: string,
  expectedData: string,
  repetitions = 1
): Promise<void> {
  await clearPtyWriteLog(app)
  await focusActiveTerminalInput(page)
  for (let index = 0; index < repetitions; index++) {
    await page.keyboard.press(chord)
  }

  // Match exact bytes: single control codes can occur inside unrelated prompt/paste writes.
  await expect
    .poll(async () => (await getPtyWrites(app)).filter((write) => write === expectedData).length, {
      timeout: 5_000,
      message: `Expected chord "${chord}" to write ${JSON.stringify(expectedData)}`
    })
    .toBeGreaterThanOrEqual(repetitions)
}

const isMac = process.platform === 'darwin'
const mod = isMac ? 'Meta' : 'Control'

// Mac splits use Cmd+D/Cmd+Shift+D; Linux/Windows reserve Ctrl+D for EOF (#586) and use Ctrl+Shift+D/Alt+Shift+D.
const splitVerticalChord = isMac ? `${mod}+d` : `${mod}+Shift+d`
const splitHorizontalChord = isMac ? `${mod}+Shift+d` : 'Alt+Shift+d'

// Poll confirmation/count because fresh split may transiently report a running child.
async function closeActivePaneAndSettle(page: Page, expectedCount: number): Promise<void> {
  // Focus PaneManager’s active textarea, not the first of multiple split panes.
  await focusActiveTerminalInput(page)
  await page.keyboard.press(`${mod}+w`)
  // The "Stop running command?" confirm surfaces a "Stop and Close" action when
  // the pane still reports a running child.
  const confirmButton = page.getByRole('button', { name: /Stop and Close/i })
  await expect
    .poll(
      async () => {
        if (await confirmButton.isVisible().catch(() => false)) {
          // Surface click errors directly instead of hiding actionability/strictness failure behind a count timeout.
          await confirmButton.click().catch((err) => {
            console.warn('closeActivePaneAndSettle: confirm click failed', err)
          })
        }
        return countVisibleTerminalPanes(page)
      },
      {
        timeout: 10_000,
        message: `Expected ${expectedCount} visible terminal panes after close`
      }
    )
    .toBe(expectedCount)
}

// Serialize shared layout/buffer/expand state and the singleton main pty:write spy to prevent interleaved chord effects.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Shortcuts', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    const hasPaneManager = await waitForActiveTerminalManager(occPage, 30_000)
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hasPaneManager,
      'Electron automation in this environment never mounts the live TerminalPane manager.'
    )
    await waitForPaneCount(occPage, 1, 30_000)
  })

  test('Shift+Enter follows the pane Kitty keyboard state', async ({ occPage, electronApp }) => {
    await installMainProcessPtyWriteSpy(electronApp)
    const ptyId = await waitForActivePanePtyId(occPage)

    await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b\r')
    if (process.platform === 'win32') {
      return
    }

    // Drive the production PTY-output mirror that shortcut policy reads, not renderer-local flags.
    // Disarm before exit because host grounding clears flags left armed.
    await execInTerminal(occPage, ptyId, "printf '\\033[>1u'; read -r _; printf '\\033[<u'")
    await expect.poll(() => getKittyKeyboardFlags(occPage)).toBe(1)
    await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b[13;2u')

    await sendToTerminal(occPage, ptyId, '\r')
    await expect.poll(() => getKittyKeyboardFlags(occPage)).toBe(0)
    await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b\r')
  })

  test('Droid gets CSI-u Shift+Enter on Windows without changing Antigravity', async ({
    occPage,
    electronApp
  }) => {
    test.skip(process.platform !== 'win32', 'Windows ConPTY encoding contract')
    await installMainProcessPtyWriteSpy(electronApp)
    await waitForActivePanePtyId(occPage)
    const paneKey = await setActivePaneForegroundAgent(occPage, 'droid')
    try {
      await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b[13;2u', 2)
      await setActivePaneForegroundAgent(occPage, 'antigravity')
      await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b\r')
    } finally {
      await occPage.evaluate(
        (key) => window.__store?.getState().clearPaneForegroundAgent(key),
        paneKey
      )
    }
  })

  test('Windows forwards genuine Ctrl+Alt text chords to the PTY', async ({
    occPage,
    electronApp
  }) => {
    test.skip(process.platform !== 'win32', 'Windows xterm AltGr classification regression')
    await installMainProcessPtyWriteSpy(electronApp)
    await waitForActivePanePtyId(occPage)

    await pressAndExpectWrite(occPage, electronApp, 'Control+Alt+u', '\x1b\x15')
    await pressAndExpectWrite(occPage, electronApp, 'Control+Alt+2', '\x1b2')
    await pressAndExpectWrite(occPage, electronApp, 'Control+Alt+;', '\x1b;')
  })

  test('Ctrl+Enter protects local ConPTY shells without breaking trusted TUI chords', async ({
    occPage,
    electronApp
  }) => {
    await installMainProcessPtyWriteSpy(electronApp)
    await waitForActivePanePtyId(occPage)

    if (process.platform === 'win32') {
      await pressAndExpectWrite(occPage, electronApp, 'Control+Enter', '\r')
      const paneKey = await setActivePaneForegroundAgent(occPage, 'droid')
      try {
        // Droid queries CSI-u without activating live flags; trusted process evidence preserves cue/queue.
        await pressAndExpectWrite(occPage, electronApp, 'Control+Enter', '\x1b[13;5u')
      } finally {
        await occPage.evaluate(
          (key) => window.__store?.getState().clearPaneForegroundAgent(key),
          paneKey
        )
      }
      return
    }

    // Preserve the established query-only Droid/Grok contract outside local ConPTY.
    await pressAndExpectWrite(occPage, electronApp, 'Control+Enter', '\x1b[13;5u')
  })

  test('plain Ctrl+C sends ETX and leaves a surviving app its kitty flags', async ({
    occPage,
    electronApp
  }) => {
    test.skip(process.platform === 'win32', 'POSIX trap and printf fixture')
    await installMainProcessPtyWriteSpy(electronApp)
    const ptyId = await waitForActivePanePtyId(occPage)
    // SIGINT during shell startup kills the shell, so interrupt only a ready prompt.
    await execInTerminal(occPage, ptyId, 'echo "CTRL_C_""READY"')
    await waitForTerminalOutput(occPage, 'CTRL_C_READY')
    // An app that survives SIGINT, like an agent TUI, and disarms its own flags on exit.
    await armKittyKeyboardFromPty(
      occPage,
      ptyId,
      `bash -c 'trap "" INT; printf "\\033[=31u"; read -r _; printf "\\033[=0u"'`
    )

    await interruptAndExpectEtx(occPage, electronApp)

    // Require xterm and policy mirror to retain encoding after unproven app death (Shift+Enter stays CSI-u).
    expect(await getKittyKeyboardFlags(occPage)).toBe(31)
    await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b[13;2u')

    await sendToTerminal(occPage, ptyId, '\r')
    await expect.poll(async () => await getKittyKeyboardFlags(occPage)).toBe(0)
    await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b\r')
  })

  test('the host grounds kitty flags an app killed by Ctrl+C left armed', async ({
    occPage,
    electronApp
  }) => {
    test.skip(process.platform === 'win32', 'POSIX printf fixture')
    await installMainProcessPtyWriteSpy(electronApp)
    const ptyId = await waitForActivePanePtyId(occPage)
    await execInTerminal(occPage, ptyId, 'echo "CTRL_C_""READY"')
    await waitForTerminalOutput(occPage, 'CTRL_C_READY')
    // `cat` dies on SIGINT with the flags still armed, like a crashed TUI.
    await armKittyKeyboardFromPty(occPage, ptyId, `printf '\\033[=31u'; cat`)

    await interruptAndExpectEtx(occPage, electronApp)

    await expect
      .poll(async () => await getKittyKeyboardFlags(occPage), {
        timeout: 5_000,
        message: 'the host did not ground the dead app kitty flags at command end'
      })
      .toBe(0)
    await clearPtyWriteLog(electronApp)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.type('x')
    await expect
      .poll(async () => (await getPtyWrites(electronApp)).some((write) => write === 'x'), {
        timeout: 5_000,
        message: 'Post-interrupt keyboard input stayed in Kitty CSI-u mode'
      })
      .toBe(true)
    expect((await getPtyWrites(electronApp)).join('')).not.toContain('\x1b[')
    await occPage.keyboard.press('Backspace')
  })

  test('unselected Cmd+C reaches a Kitty app, including after Ctrl+C', async ({
    occPage,
    electronApp
  }) => {
    test.skip(process.platform !== 'darwin', 'macOS copy binding')
    await installMainProcessPtyWriteSpy(electronApp)
    const ptyId = await waitForActivePanePtyId(occPage)
    await execInTerminal(occPage, ptyId, 'echo "CMD_C_""READY"')
    await waitForTerminalOutput(occPage, 'CMD_C_READY')
    const select = (text: string | null): Promise<string> =>
      occPage.evaluate(async (selectedText) => {
        const state = window.__store!.getState()
        const pane = window.__paneManagers!.get(state.activeTabId!)!.getActivePane()!
        if (selectedText === null) {
          pane.terminal.clearSelection()
          return ''
        }
        await new Promise<void>((resolve) =>
          pane.terminal.write(`\r\n${selectedText}\r\n`, resolve)
        )
        const buffer = pane.terminal.buffer.active
        pane.terminal.select(0, buffer.baseY + buffer.cursorY - 1, selectedText.length)
        return pane.terminal.getSelection()
      }, text)
    // Presses Cmd+C, then a marker chord whose write proves the Cmd+C bytes had their turn.
    const pressCmdC = async (marker: string, markerWrite: string): Promise<string[]> => {
      await clearPtyWriteLog(electronApp)
      await focusActiveTerminalInput(occPage)
      await occPage.keyboard.press('Meta+c')
      await occPage.keyboard.press(marker)
      await expect.poll(async () => await getPtyWrites(electronApp)).toContain(markerWrite)
      const writes = await getPtyWrites(electronApp)
      return writes.slice(0, writes.indexOf(markerWrite))
    }
    const kittyCmdC = ['\x1b[99;9;99u', '\x1b[99;9:3u']
    const originalClipboard = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    try {
      await select(null)
      expect(await pressCmdC('x', 'x')).toEqual([])
      await occPage.keyboard.press('Backspace')

      // An app that survives SIGINT, like an agent TUI, and disarms its own flags on exit.
      await armKittyKeyboardFromPty(
        occPage,
        ptyId,
        `bash -c 'trap "" INT; printf "\\033[=31u"; read -r _; printf "\\033[=0u"'`
      )
      await select(null)
      expect(await pressCmdC('Shift+Enter', '\x1b[13;2u')).toEqual(kittyCmdC)

      const selectedText = await select('Terminal copy selection')
      expect(selectedText).toBe('Terminal copy selection')
      await electronApp.evaluate(({ clipboard }) => clipboard.writeText(''))
      expect(await pressCmdC('Shift+Enter', '\x1b[13;2u')).toEqual([])
      await expect
        .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(selectedText)

      await interruptAndExpectEtx(occPage, electronApp)
      expect(await getKittyKeyboardFlags(occPage)).toBe(31)
      await select(null)
      expect(await pressCmdC('Shift+Enter', '\x1b[13;2u')).toEqual(kittyCmdC)

      await sendToTerminal(occPage, ptyId, '\r')
      await expect.poll(async () => await getKittyKeyboardFlags(occPage)).toBe(0)
      expect(await pressCmdC('x', 'x')).toEqual([])
      await occPage.keyboard.press('Backspace')
    } finally {
      await electronApp.evaluate(
        ({ clipboard }, text) => clipboard.writeText(text),
        originalClipboard
      )
    }
  })

  test('floating terminal owns tab switch shortcuts while focused', async ({ occPage }) => {
    const scenario = await seedFloatingTerminalTabSwitchScenario(occPage)
    await occPage.evaluate(async () => {
      const state = window.__store?.getState()
      if (state?.settings?.floatingTerminalEnabled !== true) {
        await state?.updateSettings({ floatingTerminalEnabled: true })
      }
      if (!document.querySelector('[data-floating-terminal-panel][aria-hidden="false"]')) {
        window.dispatchEvent(new CustomEvent('occ-toggle-floating-terminal'))
      }
    })
    await expect(
      occPage.locator('[data-floating-terminal-panel][aria-hidden="false"]')
    ).toBeVisible()
    await focusFloatingTerminal(occPage)

    await occPage.keyboard.press(`${mod}+Shift+BracketRight`)
    await expect
      .poll(() => getActiveFloatingTerminalTabId(occPage), {
        timeout: 5_000,
        message: 'floating terminal did not switch to the next tab'
      })
      .toBe(scenario.floatingSecondTabId)
    await expect
      .poll(() => getActiveBackgroundTerminalTabId(occPage), {
        timeout: 1_000,
        message: 'background terminal tab changed while floating terminal was focused'
      })
      .toBe(scenario.backgroundFirstTabId)

    await focusFloatingTerminal(occPage)
    await occPage.keyboard.press(`${mod}+Shift+BracketLeft`)
    await expect
      .poll(() => getActiveFloatingTerminalTabId(occPage), {
        timeout: 5_000,
        message: 'floating terminal did not switch back to the previous tab'
      })
      .toBe(scenario.floatingFirstTabId)
    await expect(getActiveBackgroundTerminalTabId(occPage)).resolves.toBe(
      scenario.backgroundFirstTabId
    )
  })

  test('all terminal chords reach the PTY or fire their action', async ({
    occPage,
    electronApp
  }) => {
    await installMainProcessPtyWriteSpy(electronApp)

    const ptyId = await waitForActivePanePtyId(occPage)
    const marker = `SHORTCUT_TEST_${Date.now()}`
    await execInTerminal(occPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(occPage, marker)

    // Alt+←/→ → readline backward-word / forward-word (\eb / \ef).
    await pressAndExpectWrite(occPage, electronApp, 'Alt+ArrowLeft', '\x1bb')
    await pressAndExpectWrite(occPage, electronApp, 'Alt+ArrowRight', '\x1bf')

    // Ctrl+←/→ on non-mac → readline backward-word / forward-word (\eb / \ef).
    // macOS reserves Ctrl+Arrow; Windows ConPTY leaves it to PSReadLine.
    if (!isMac && process.platform !== 'win32') {
      await pressAndExpectWrite(occPage, electronApp, 'Control+ArrowLeft', '\x1bb')
      await pressAndExpectWrite(occPage, electronApp, 'Control+ArrowRight', '\x1bf')
    }

    // Alt+Backspace → Esc+DEL (readline backward-kill-word).
    await pressAndExpectWrite(occPage, electronApp, 'Alt+Backspace', '\x1b\x7f')

    // Ctrl+Backspace → \x17 (unix-word-rubout).
    await pressAndExpectWrite(occPage, electronApp, 'Control+Backspace', '\x17')

    // The shell has not enabled KKP, so Shift+Enter must not leak CSI-u text.
    await pressAndExpectWrite(occPage, electronApp, 'Shift+Enter', '\x1b\r')

    if (isMac) {
      // Cmd+←/→ → Ctrl+A / Ctrl+E (beginning/end of line).
      await pressAndExpectWrite(occPage, electronApp, 'Meta+ArrowLeft', '\x01')
      await pressAndExpectWrite(occPage, electronApp, 'Meta+ArrowRight', '\x05')

      // Cmd+Backspace → Ctrl+U (kill line). Cmd+Delete → Ctrl+K (kill to EOL).
      await pressAndExpectWrite(occPage, electronApp, 'Meta+Backspace', '\x15')
      await pressAndExpectWrite(occPage, electronApp, 'Meta+Delete', '\x0b')
    }

    await occPage.evaluate(async () => {
      await window.__store!.getState().setKeybindingOverride('terminal.clear', ['Mod+Shift+K'])
    })
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${mod}+Shift+k`)
    await expect
      .poll(async () => (await getTerminalContent(occPage)).includes(marker), {
        timeout: 5_000,
        message: 'The configured clear shortcut did not clear the terminal buffer'
      })
      .toBe(false)
    await occPage.evaluate(async () => {
      await window.__store!.getState().resetKeybindingOverride('terminal.clear')
    })

    const panesBeforeSplit = await countVisibleTerminalPanes(occPage)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(splitVerticalChord)
    await waitForPaneCount(occPage, panesBeforeSplit + 1)
    // Require the split PTY binding before close to avoid racing unfinished creation.
    await waitForActivePanePtyId(occPage)

    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${mod}+BracketRight`)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${mod}+BracketLeft`)
    expect(await countVisibleTerminalPanes(occPage)).toBe(panesBeforeSplit + 1)

    // Test expand while split remains open because it requires >1 pane.
    const readExpanded = async (): Promise<boolean> =>
      occPage.evaluate(() => {
        const state = window.__store?.getState()
        const tabId = state?.activeTabId
        if (!state || !tabId) {
          return false
        }
        return state.expandedPaneByTabId[tabId] === true
      })
    expect(await readExpanded()).toBe(false)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${mod}+Shift+Enter`)
    await expect
      .poll(readExpanded, { timeout: 3_000, message: 'Cmd+Shift+Enter did not expand pane' })
      .toBe(true)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${mod}+Shift+Enter`)
    await expect
      .poll(readExpanded, { timeout: 3_000, message: 'Cmd+Shift+Enter did not collapse pane' })
      .toBe(false)

    await closeActivePaneAndSettle(occPage, panesBeforeSplit)

    const panesBeforeHSplit = await countVisibleTerminalPanes(occPage)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(splitHorizontalChord)
    await waitForPaneCount(occPage, panesBeforeHSplit + 1)
    await waitForActivePanePtyId(occPage)
    await closeActivePaneAndSettle(occPage, panesBeforeHSplit)

    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press(`${mod}+f`)
    const searchInput = occPage.locator('[data-terminal-search-root] input').first()
    // Wait for search-input focus: React’s Escape handler otherwise loses an early key to xterm.
    await expect(searchInput).toBeFocused({ timeout: 3_000 })
    await occPage.keyboard.press('Escape')
    await expect(occPage.locator('[data-terminal-search-root]').first()).toBeHidden({
      timeout: 3_000
    })
  })

  test('Cmd+Up/Down scrolls terminal viewport without writing to the PTY on macOS', async ({
    occPage,
    electronApp
  }) => {
    test.skip(!isMac, 'Cmd+Up/Down terminal scroll navigation is macOS-only')

    await installMainProcessPtyWriteSpy(electronApp)

    const ptyId = await waitForActivePanePtyId(occPage)
    const marker = `CMD_ARROW_SCROLL_${Date.now()}`
    await execInTerminal(occPage, ptyId, `for i in {1..120}; do echo ${marker}_$i; done`)
    await waitForTerminalOutput(occPage, `${marker}_120`)

    await expect
      .poll(
        async () => {
          const viewport = await getActiveTerminalViewport(occPage)
          return viewport.baseY > 0 && viewport.viewportY === viewport.baseY
        },
        {
          timeout: 5_000,
          message: 'terminal did not settle at the bottom with scrollback for Cmd+Up/Down repro'
        }
      )
      .toBe(true)

    await clearPtyWriteLog(electronApp)
    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press('Meta+ArrowUp')
    await expect
      .poll(async () => getActiveTerminalViewport(occPage), {
        timeout: 5_000,
        message: 'Cmd+Up did not scroll the terminal viewport to the top'
      })
      .toMatchObject({ viewportY: 0 })
    expect(await getPtyWrites(electronApp)).toEqual([])

    await focusActiveTerminalInput(occPage)
    await occPage.keyboard.press('Meta+ArrowDown')
    await expect
      .poll(
        async () => {
          const viewport = await getActiveTerminalViewport(occPage)
          return viewport.viewportY === viewport.baseY
        },
        {
          timeout: 5_000,
          message: 'Cmd+Down did not scroll the terminal viewport to the bottom'
        }
      )
      .toBe(true)
    expect(await getPtyWrites(electronApp)).toEqual([])
  })
})
