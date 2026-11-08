import { expect, it } from 'vitest'
import { OCC_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { createStaleTabCloseHarness } from '../../__fixtures__/occ-runtime-terminal-close-continuity-fixtures'
import { WORKTREE_ID } from '../../__fixtures__/occ-runtime-terminal-close-continuity-state-fixture'

;(OCC_LAYOUT_OWNER_IS_MAIN ? it.fails : it)(
  'keeps host retirement proof across a later renderer publication',
  async () => {
    const harness = await createStaleTabCloseHarness({ headless: true })
    await harness.runtime.closeTerminalTab(harness.terminal.handle)
    const before = await harness.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(before.retiredTerminalSurfaces).toHaveLength(1)

    harness.runtime.syncWindowGraph(1, {
      tabs: [],
      leaves: [],
      mobileSessionTabs: [
        {
          worktree: WORKTREE_ID,
          publicationEpoch: 'renderer:close-continuity',
          snapshotVersion: 100,
          activeGroupId: null,
          activeTabId: null,
          activeTabType: null,
          tabs: []
        }
      ]
    })
    const after = await harness.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(after.tabs).toEqual([])
    expect(after.retiredTerminalSurfaces).toEqual(before.retiredTerminalSurfaces)
  }
)
