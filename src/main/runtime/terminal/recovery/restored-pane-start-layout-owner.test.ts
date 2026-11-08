// Restored panes share main's starter across first-view, CLI and orchestration triggers.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../shared/layout-owner-switch', () => ({ OCC_LAYOUT_OWNER_IS_MAIN: true }))

// Fragments stay side-effect ordered: mocks, then lifecycle, then fixtures.
await import('../../occ-runtime-tests/runtime-test-module-registration.spec')
const { OCCRuntimeService } = await import('../../occ-runtime')
await import('../../occ-runtime-tests/occ-runtime-test-lifecycle.spec')
const {
  HEADLESS_LEAF_ID,
  TEST_WORKTREE_ID,
  deferred,
  makeRuntimeStoreWithWorkspaceSession,
  makeWorkspaceSessionWithHeadlessTerminal
} = await import('../../occ-runtime-tests/occ-runtime-test-fixtures.spec')
const { committingSpawn } = await import('../../occ-runtime-tests/bind-first-pane.test-fixture')

function windowlessRuntime() {
  const { runtimeStore, getSession, setSession } = makeRuntimeStoreWithWorkspaceSession(
    makeWorkspaceSessionWithHeadlessTerminal()
  )
  const runtime = new OCCRuntimeService(runtimeStore)
  const started = deferred<{ id: string }>()
  const spawn = vi.fn(
    (_args: { worktreeId?: string; tabId?: string; leafId?: string }) => started.promise
  )
  runtime.setPtyController({
    spawn: committingSpawn(runtime, spawn),
    write: () => true,
    kill: () => false,
    stopAndWait: async () => true,
    getForegroundProcess: async () => null,
    listProcesses: async () => []
  })
  runtime.syncWindowGraph(0, { tabs: [], leaves: [] })
  return { runtime, spawn, started, getSession, setSession }
}

describe('a restored pane with no live terminal, on a host with no window (layout-owner build)', () => {
  it("refuses a client's first view of a pane main dropped after the client listed it", async () => {
    const { runtime, spawn, getSession, setSession } = windowlessRuntime()
    await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)
    const session = getSession()
    setSession({
      ...session,
      tabsByWorktree: { ...session.tabsByWorktree, [TEST_WORKTREE_ID]: [] }
    })

    await expect(
      runtime.activateMobileSessionTab(`id:${TEST_WORKTREE_ID}`, 'host-tab', HEADLESS_LEAF_ID, {
        notifyClients: false,
        navigation: 'caller',
        intent: 'user'
      })
    ).rejects.toThrow('tab_not_found')
    expect(spawn).not.toHaveBeenCalled()
  })
})
