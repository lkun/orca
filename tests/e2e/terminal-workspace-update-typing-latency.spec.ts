// Benchmark echo while the accumulated store publishes workspace order/status updates; only the typing PTY is spawned.
// Run pnpm bench:multi-workspace-typing -- --grep accumulated; the runner documents knobs and results land in tests/tools/benchmarks/results/.
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/occ-app'
import { readTypingScaleCensus } from './typing-scale-census'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePanePtyId, waitForActiveTerminalManager } from './helpers/terminal'
import { writeTypingEchoProbeScript } from './sustained-agent-typing-load-scripts'
import {
  cleanupAccumulatedWorkspaceFixture,
  seedAccumulatedWorkspaceFixture
} from './accumulated-workspace-fixture'
import {
  startAccumulatedStatusTraffic,
  stopAccumulatedStatusTraffic
} from './accumulated-workspace-status-fixture'
import {
  startAccumulatedOrderTraffic,
  stopAccumulatedOrderTraffic
} from './accumulated-workspace-order-fixture'
import {
  BENCH_ENABLED,
  readPositiveInt,
  KEY_COUNT,
  ORDER_CHURN_MS,
  readSchedulerDebug,
  readMainDeliveryDebug,
  resetDeliveryDebug,
  measureTypingWindow,
  writeBenchReport,
  startTypingProbe,
  stopPtysQuietly
} from './multi-workspace-typing-bench'

test.describe('Accumulated workspace-update typing latency bench', () => {
  // Seeding thousands of workspace records plus a paced typing window outlasts the default timeout.
  test.setTimeout(10 * 60 * 1000)
  test.skip(!BENCH_ENABLED, 'Bench-only: run via pnpm bench:multi-workspace-typing')

  // Workspace-update pressure without load PTYs: the reported stalls came from store publications, not terminal bytes.
  test('typing under accumulated workspace-update pressure', async ({
    electronApp,
    occPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)
    const typingPtyId = await waitForActivePanePtyId(occPage)

    const runId = randomUUID()
    const probePath = path.join(testRepoPath, `.occ-mwt-probe-${runId}.mjs`)
    const sidecarPath = path.join(testRepoPath, `.occ-mwt-arrivals-${runId}.jsonl`)
    writeTypingEchoProbeScript(probePath, runId, sidecarPath)
    let orderTrafficStarted = false
    let statusTrafficStarted = false
    try {
      const fixtureSummary = await seedAccumulatedWorkspaceFixture(occPage, {
        worktrees: readPositiveInt('OCC_TYPING_BENCH_METADATA_WORKTREES', 870),
        repositories: readPositiveInt('OCC_TYPING_BENCH_METADATA_REPOSITORIES', 27),
        terminalTabs: readPositiveInt('OCC_TYPING_BENCH_METADATA_TERMINAL_TABS', 1410),
        unifiedTabs: readPositiveInt('OCC_TYPING_BENCH_METADATA_UNIFIED_TABS', 2000),
        panesPerTab: readPositiveInt('OCC_TYPING_BENCH_METADATA_PANES', 1),
        sleepingRecords: readPositiveInt('OCC_TYPING_BENCH_METADATA_SLEEPERS', 857),
        liveStatuses: readPositiveInt('OCC_TYPING_BENCH_METADATA_LIVE_STATUSES', 177),
        statusHistoryEntries: readPositiveInt('OCC_TYPING_BENCH_METADATA_STATUS_HISTORY', 3)
      })
      if (process.env.OCC_TYPING_BENCH_METADATA_STATUS === '1') {
        await startAccumulatedStatusTraffic(
          electronApp,
          occPage,
          readPositiveInt('OCC_TYPING_BENCH_METADATA_STATUS_INTERVAL_MS', 100)
        )
        statusTrafficStarted = true
      }
      if (ORDER_CHURN_MS > 0) {
        expect(await startAccumulatedOrderTraffic(occPage, ORDER_CHURN_MS)).toBe(
          fixtureSummary.repositories
        )
        orderTrafficStarted = true
      }
      await resetDeliveryDebug(occPage)
      await startTypingProbe(occPage, typingPtyId, probePath, runId)
      const measured = await measureTypingWindow(occPage, runId, sidecarPath)
      const orderWorkload = orderTrafficStarted ? await stopAccumulatedOrderTraffic(occPage) : null
      orderTrafficStarted = false
      const statusWorkload = statusTrafficStarted
        ? await stopAccumulatedStatusTraffic(electronApp, occPage)
        : null
      statusTrafficStarted = false
      writeBenchReport(
        testInfo,
        `workspace-updates${ORDER_CHURN_MS > 0 ? `-order${ORDER_CHURN_MS}ms` : ''}${statusWorkload ? '-status' : ''}`,
        measured,
        {
          cpuWorkers: 0,
          ptyMetadata: false,
          statusTrafficModel: statusWorkload ? 'electron-ipc-burst-through-production-bridge' : null
        },
        await readSchedulerDebug(occPage),
        await readMainDeliveryDebug(occPage),
        undefined,
        null,
        statusWorkload,
        null,
        await readTypingScaleCensus(occPage),
        fixtureSummary,
        undefined,
        null,
        null,
        null,
        orderWorkload
      )
      expect(measured.measurement.totalMs?.count).toBe(KEY_COUNT)
      if (orderWorkload) {
        expect(orderWorkload.publications).toBeGreaterThan(0)
      }
    } finally {
      if (orderTrafficStarted) {
        await stopAccumulatedOrderTraffic(occPage).catch(() => null)
      }
      if (statusTrafficStarted) {
        await stopAccumulatedStatusTraffic(electronApp, occPage).catch(() => null)
      }
      await cleanupAccumulatedWorkspaceFixture(occPage)
      await stopPtysQuietly(occPage, [typingPtyId])
      rmSync(probePath, { force: true })
      rmSync(sidecarPath, { force: true })
    }
  })
})
