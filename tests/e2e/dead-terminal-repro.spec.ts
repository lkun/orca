// Require @headful WebGL: DOM fallback cannot reproduce canvas staleness after split reparenting.

import { test, expect } from './helpers/occ-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { waitForActiveTerminalManager, waitForPaneCount } from './helpers/terminal'
import {
  createAndActivateWorktreeWithManualSplit,
  removeWorktreeViaStore,
  waitForAllPanesToHaveContent,
  checkWebglState
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Reproduction @headful', () => {
  const createdWorktreeIds: string[] = []

  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
  })

  test.afterEach(async ({ occPage }) => {
    for (const id of createdWorktreeIds) {
      await removeWorktreeViaStore(occPage, id)
    }
    createdWorktreeIds.length = 0
  })

  test('@headful manual-split flow does not produce dead terminals', async ({ occPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)
    await checkWebglState(occPage, 'home-initial')

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const direction = i % 2 === 0 ? 'vertical' : 'horizontal'
      const newId = await createAndActivateWorktreeWithManualSplit(
        occPage,
        `setup-${i}`,
        direction
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 30_000)
      await waitForPaneCount(occPage, 2, 15_000)
      await checkWebglState(occPage, `setup-${i}`)
      await waitForAllPanesToHaveContent(occPage, `setup-${i} both panes`)

      await switchToWorktree(occPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(occPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful manual-split then switch-back does not leave panes dead', async ({ occPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        occPage,
        `switchback-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 30_000)
      await waitForPaneCount(occPage, 2, 15_000)
      await waitForAllPanesToHaveContent(occPage, `switchback-${i} initial`)

      await switchToWorktree(occPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 15_000)

      await switchToWorktree(occPage, newId)
      await expect.poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 15_000)
      await waitForAllPanesToHaveContent(occPage, `switchback-${i} after return`)

      await switchToWorktree(occPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(occPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful rapid switching between many manual-split worktrees', async ({ occPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)

    const worktreeIds = [homeWorktreeId]
    for (let i = 0; i < 4; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        occPage,
        `multi-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)
      worktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 30_000)
      await waitForPaneCount(occPage, 2, 15_000)
      await waitForAllPanesToHaveContent(occPage, `multi-create-${i}`)
    }

    for (let round = 0; round < 3; round++) {
      for (const wId of worktreeIds) {
        await switchToWorktree(occPage, wId)
        await expect.poll(async () => getActiveWorktreeId(occPage), { timeout: 10_000 }).toBe(wId)
        await ensureTerminalVisible(occPage)
        await waitForActiveTerminalManager(occPage, 15_000)
        await waitForAllPanesToHaveContent(occPage, `multi-r${round}-${wId.slice(0, 8)}`)
      }
    }
  })
})
