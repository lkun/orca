import { expect, test } from './helpers/occ-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Split the marker so terminal input echo cannot impersonate successful shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ occPage }) => {
  await waitForSessionReady(occPage)
  await waitForActiveWorktree(occPage)
  await ensureTerminalVisible(occPage)
  await configureGoldenStubAgent(occPage)
  await launchGoldenStubAgentFromNewTab(occPage)

  await occPage.keyboard.type('exit')
  await occPage.keyboard.press('Enter')
  await waitForTerminalOutput(occPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await occPage.locator('[data-testid="sortable-tab"]').count()
  await occPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await occPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(occPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(occPage)
  // A bound pane can precede transport readiness; wait or marker keystrokes may be dropped.
  expect(await waitForRestoredTerminalInputReady(occPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(occPage)
  await occPage.keyboard.type(afterAgent.command)
  await occPage.keyboard.press('Enter')
  await waitForTerminalOutput(occPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await occPage.keyboard.press('Shift+Enter')
  await occPage.keyboard.type(afterShiftEnter.command)
  await occPage.keyboard.press('Enter')
  await waitForTerminalOutput(occPage, afterShiftEnter.marker, 15_000)
  await expect(occPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
