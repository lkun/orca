import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  getTerminalContent,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

// Stream inline synchronized Working… frames after filling scrollback, continuing while hidden to force snapshot restore on return.
function streamingAgentFixtureScript(runId: string): string {
  return `
async function writeStdout(chunk) {
  await new Promise((resolve) => process.stdout.write(chunk, resolve))
}
let row = 0
let pre = ''
for (; row < 300; row += 1) {
  pre += 'STREAMING_SWITCH_${runId}_ROW_' + String(row).padStart(4, '0') + '\\n'
}
await writeStdout(pre + 'STREAMING_SWITCH_${runId}_PRESTREAM_DONE\\n')
const spinner = ['|', '/', '-', '\\\\']
for (let tick = 0; tick < 800; tick += 1) {
  let frame = '\\x1b[?2026h'
  if (tick % 3 === 0) {
    frame += '\\r\\x1b[2KSTREAMING_SWITCH_${runId}_ROW_' + String(row).padStart(4, '0') + '\\n'
    row += 1
  }
  frame += '\\r\\x1b[2KWorking… ' + spinner[tick % 4] + ' tick=' + tick + '\\x1b[?2026l'
  await writeStdout(frame)
  await new Promise((resolve) => setTimeout(resolve, 50))
}
`
}

async function closeFeatureTips(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    store
      ?.getState()
      .markFeatureTipsSeen(['occ-cli', 'cmd-j-palette', 'voice-dictation', 'agent-session-search'])
    if (store?.getState().activeModal === 'feature-tips') {
      store.getState().closeModal()
    }
  })
}

async function pinActiveTerminalNearBottom(page: Page): Promise<{
  tabId: string
  targetViewportY: number
  baseY: number
}> {
  return page.evaluate(() => {
    const store = window.__store
    const state = store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!tabId || !pane) {
      throw new Error('Active terminal pane unavailable')
    }
    const target = pane.container.querySelector<HTMLElement>('.xterm') ?? pane.container
    target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -240
      })
    )
    const buffer = pane.terminal.buffer.active
    const targetViewportY = Math.max(0, buffer.baseY - 6)
    pane.terminal.scrollToLine(targetViewportY)
    pane.container
      .querySelector<HTMLElement>('.xterm-viewport')
      ?.dispatchEvent(new Event('scroll', { bubbles: true }))
    return { tabId, targetViewportY, baseY: buffer.baseY }
  })
}

async function readSettledViewport(
  page: Page,
  tabId: string
): Promise<{ viewportY: number; baseY: number }> {
  // Wait for parsed replay (regrown scrollback) and stable viewport before reading its position.
  let last: { viewportY: number; baseY: number } | null = null
  let stableCount = 0
  await expect
    .poll(
      async () => {
        const current = await page.evaluate((tabId) => {
          const manager = window.__paneManagers?.get(tabId)
          const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
          const buffer = pane?.terminal?.buffer?.active
          return buffer ? { viewportY: buffer.viewportY, baseY: buffer.baseY } : null
        }, tabId)
        if (!current || current.baseY < 100) {
          stableCount = 0
          last = current
          return false
        }
        if (last && current.viewportY === last.viewportY) {
          stableCount += 1
        } else {
          stableCount = 0
        }
        last = current
        return stableCount >= 3
      },
      {
        timeout: 20_000,
        intervals: [250],
        message: 'terminal viewport did not settle after returning to the streaming worktree'
      }
    )
    .toBe(true)
  if (!last) {
    throw new Error('viewport settle poll finished without a sample')
  }
  return last
}

test.describe('Terminal pinned viewport with streaming agent across worktree switch', () => {
  test('returning to a pinned pane with an active stream does not land at the top', async ({
    occPage,
    testRepoPath
  }) => {
    await waitForSessionReady(occPage)
    await closeFeatureTips(occPage)
    const firstWorktreeId = await waitForActiveWorktree(occPage)
    const secondWorktreeId = (await getAllWorktreeIds(occPage)).find(
      (id) => id !== firstWorktreeId
    )
    test.skip(!secondWorktreeId, 'streaming pinned repro needs the seeded secondary worktree')
    if (!secondWorktreeId) {
      return
    }

    await ensureTerminalVisible(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)
    const ptyId = await waitForActivePanePtyId(occPage)
    await waitForPtyShellEcho(occPage, ptyId, 15_000)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.occ-streaming-switch-${runId}.mjs`)
    writeFileSync(scriptPath, streamingAgentFixtureScript(runId))

    try {
      await sendToTerminal(occPage, ptyId, `${nodeTerminalCommand([scriptPath])}\r`)
      await expect
        .poll(() => getTerminalContent(occPage, 30_000), {
          timeout: 15_000,
          message: 'streaming fixture did not reach terminal scrollback'
        })
        .toContain(`STREAMING_SWITCH_${runId}_PRESTREAM_DONE`)

      const pinned = await pinActiveTerminalNearBottom(occPage)
      expect(pinned.baseY).toBeGreaterThan(100)
      await occPage.waitForTimeout(150)

      // Hidden drops force snapshot restore while the agent continues streaming.
      await switchToWorktree(occPage, secondWorktreeId)
      await waitForActiveTerminalManager(occPage, 30_000)
      await occPage.waitForTimeout(3_000)

      await switchToWorktree(occPage, firstWorktreeId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 30_000)

      const settled = await readSettledViewport(occPage, pinned.tabId)
      const bottomDistance = settled.baseY - settled.viewportY
      // Require the six-row user pin; the bug clamped to scrollback’s top.
      expect(
        settled.viewportY,
        `settled at viewportY=${settled.viewportY} baseY=${settled.baseY} (pinned ${JSON.stringify(pinned)})`
      ).toBeGreaterThan(20)
      expect(
        bottomDistance,
        `settled ${bottomDistance} rows above the bottom (pinned 6 rows above)`
      ).toBeGreaterThan(1)
      expect(
        bottomDistance,
        `settled ${bottomDistance} rows above the bottom (pinned 6 rows above)`
      ).toBeLessThan(80)
    } finally {
      rmSync(scriptPath, { force: true })
    }
  })
})
