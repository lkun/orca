import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/occ-app'
import { postClaudeHook, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { SIDEBAR_INPUTS_BUILD } from './helpers/sidebar-inputs-build'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { RECENT_STAMP_THROTTLE_MS } from '../../src/shared/sidebar-list/sort-stamps'

test.skip(
  !SIDEBAR_INPUTS_BUILD,
  'the window sorts by host stamps only in an OCC_SIDEBAR_INPUTS=main build'
)

async function rowOrder(page: Page, ids: string[]): Promise<string[]> {
  return page.evaluate(
    (wanted) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-worktree-id]'))
        .filter((row) => row.getAttribute('role') === 'option')
        .map((row) => row.dataset.worktreeId ?? '')
        .filter((id) => wanted.includes(id)),
    ids
  )
}

test('the window sidebar order follows the host stamps in Recent and Smart', async ({
  occPage,
  electronApp
}) => {
  test.setTimeout(90_000)
  await waitForSessionReady(occPage)
  await waitForActiveWorktree(occPage)
  await ensureTerminalVisible(occPage)
  await waitForActiveTerminalManager(occPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)
  const pane = await waitForActivePaneHookDescriptor(occPage)

  const otherId = await occPage.evaluate((activeId) => {
    const store = window.__store!
    store.getState().setGroupBy('none')
    store.getState().setSortBy('smart')
    const other = Object.values(store.getState().worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id !== activeId && !worktree.isArchived)
    if (!other) {
      throw new Error('Expected the seeded secondary worktree')
    }
    // A newer Recent stamp on the other row, with no tier on either.
    store.getState().updateWorktreeMeta(other.id, { lastActivityAt: Date.now() })
    return other.id
  }, pane.worktreeId)
  const ids = [pane.worktreeId, otherId]
  await expect.poll(() => rowOrder(occPage, ids)).toEqual([otherId, pane.worktreeId])

  await occPage.waitForTimeout(RECENT_STAMP_THROTTLE_MS + 500)
  await postClaudeHook(endpoint, pane, { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
  // Working outranks a row with no tier; the prompt's Recent stamp also tops Recent.
  await expect.poll(() => rowOrder(occPage, ids)).toEqual([pane.worktreeId, otherId])
  await occPage.evaluate(() => window.__store!.getState().setSortBy('recent'))
  await expect.poll(() => rowOrder(occPage, ids)).toEqual([pane.worktreeId, otherId])

  await occPage.evaluate(() => window.__store!.getState().setSortBy('smart'))
  await postClaudeHook(endpoint, pane, { hook_event_name: 'Stop', last_assistant_message: 'ok' })
  // Done holds the top with no fade and no settle.
  await occPage.waitForTimeout(2_000)
  expect(await rowOrder(occPage, ids)).toEqual([pane.worktreeId, otherId])
})
