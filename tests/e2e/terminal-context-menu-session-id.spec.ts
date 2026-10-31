/** E2E coverage for copying provider identity from the exact terminal pane. */

import { test, expect } from './helpers/occ-app'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForPaneIdentitySnapshot } from './helpers/terminal'
import { openTerminalContextMenu } from './helpers/terminal-pane-title-actions'

const SESSION_ID = 'e2e-terminal-pane-session'

test('terminal pane context menu copies its agent session ID', async ({ occPage }) => {
  await waitForSessionReady(occPage)
  const worktreeId = await waitForActiveWorktree(occPage)
  await ensureTerminalVisible(occPage)

  const tabId = await getActiveTabId(occPage)
  if (!tabId) {
    throw new Error('No active terminal tab')
  }
  const snapshot = await waitForPaneIdentitySnapshot(occPage, 1)
  const leafId = snapshot.panes[0]?.leafId
  if (!leafId) {
    throw new Error('No active terminal pane')
  }
  const paneKey = `${tabId}:${leafId}`

  // Avoid installed CLIs while exercising durable pane identity after transient status clears.
  await occPage.evaluate(
    ({ paneKey, tabId, worktreeId, sessionId }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Store unavailable')
      }
      state.recordAgentProviderSession(
        paneKey,
        'claude',
        { key: 'session_id', id: sessionId },
        undefined,
        { tabId, worktreeId }
      )
    },
    { paneKey, tabId, worktreeId, sessionId: SESSION_ID }
  )

  await expect
    .poll(
      () =>
        occPage.evaluate(
          ({ paneKey }) =>
            window.__store?.getState().sleepingAgentSessionsByPaneKey[paneKey]?.providerSession.id,
          { paneKey }
        ),
      { timeout: 3_000 }
    )
    .toBe(SESSION_ID)

  await openTerminalContextMenu(occPage)

  const identityItems = await occPage.getByRole('menuitem').allInnerTexts()
  const sessionIdIndex = identityItems.indexOf('Copy Session ID')
  expect(identityItems.slice(sessionIdIndex, sessionIdIndex + 3)).toEqual([
    'Copy Session ID',
    'Copy Terminal ID',
    'Copy Pane ID'
  ])

  const copyItem = occPage.getByRole('menuitem', { name: 'Copy Session ID', exact: true })
  await expect(copyItem).toBeVisible()
  await copyItem.click()

  await expect
    .poll(() => occPage.evaluate(() => window.api.ui.readClipboardText()), { timeout: 3_000 })
    .toBe(SESSION_ID)
})
