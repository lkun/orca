// Benchmark sustained paced real-PTY agent load while typing at fixed cadence without waiting for echoes.
// Split latency into CDP keydown→PTY receipt and receipt→xterm-buffer detection on one machine’s epoch clock; neither proves pixel paint.
// OCC_TYPING_BENCH=1 gates benchmarks, not CI regressions; OCC_TYPING_BENCH_INSTRUMENTATION=0 supplies a probe-off observer control.
// Run pnpm bench:multi-workspace-typing (runner documents knobs); JSON results go to tests/tools/benchmarks/results/.
import type { Page } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from './helpers/occ-app'
import { createTypingLoadWorkspaces, removeTypingLoadWorkspaces } from './typing-load-workspaces'
import { readTypingScaleCensus } from './typing-scale-census'
import {
  ensureTerminalVisible,
  getActiveTabId,
  getActiveWorktreeId,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import {
  ensureActiveWorktreePaneLoad,
  focusPane,
  type TerminalLoadPane
} from './artificial-opencode-pane-interactions'
import {
  sustainedLoadReadyFilePath,
  writeCodexEchoProbeScript,
  writeSustainedAgentLoadScript,
  writeTypingEchoProbeScript
} from './sustained-agent-typing-load-scripts'
import {
  startSynchronizedOutputBlackoutProbe,
  stopSynchronizedOutputBlackoutProbe,
  type SynchronizedOutputBlackoutSnapshot
} from './synchronized-output-blackout-probe'
import {
  createGitChurnRepos,
  registerGitChurnRepos,
  startGitChurnLoad,
  stopGitChurnLoad,
  type GitChurnStats
} from './git-churn-load'
import {
  cleanupAccumulatedWorkspaceFixture,
  seedAccumulatedWorkspaceFixture,
  startAccumulatedBenchmarkInstrumentation,
  stopAccumulatedBenchmarkInstrumentation
} from './accumulated-workspace-fixture'
import {
  startAccumulatedStatusTraffic,
  stopAccumulatedStatusTraffic,
  validateAccumulatedStatusIpcIngress,
  type AccumulatedStatusIngressValidation
} from './accumulated-workspace-status-fixture'
import {
  startAccumulatedTitleTraffic,
  stopAccumulatedTitleTraffic
} from './accumulated-workspace-title-fixture'
import {
  startAccumulatedOrderTraffic,
  stopAccumulatedOrderTraffic
} from './accumulated-workspace-order-fixture'
import {
  injectRendererLongTaskSelfTest,
  startRuntimeGraphPublicationProbe,
  stopRuntimeGraphPublicationProbe,
  type RendererLongTaskSelfTestWindow
} from './runtime-graph-publication-probe'
import {
  BENCH_ENABLED,
  readPositiveInt,
  LOAD_WORKSPACES,
  LOAD_PANES,
  LOAD_RATE_KBPS,
  KEY_COUNT,
  CPU_WORKERS,
  GIT_CHURN_REPOS,
  GIT_CHURN_FILES,
  GIT_CHURN_CONCURRENCY,
  CODEX_FRAME_ROWS,
  CODEX_SPLIT_DELAY_MS,
  PTY_METADATA,
  BENCH_LABEL,
  BENCH_INSTRUMENTATION_REQUESTED,
  GRAPH_PROBE_REQUESTED,
  GRAPH_PROBE_SELF_TEST_MS,
  ORDER_CHURN_MS,
  LOAD_DURATION_S,
  readSchedulerDebug,
  readMainDeliveryDebug,
  resetDeliveryDebug,
  spawnCpuPressureWorkers,
  measureTypingWindow,
  writeBenchReport,
  startTypingProbe,
  stopPtysQuietly
} from './multi-workspace-typing-bench'

async function startSustainedLoadInPanes(
  page: Page,
  panes: TerminalLoadPane[],
  scriptPath: string,
  runId: string,
  readyFileDirectory: string
): Promise<void> {
  for (const [index, pane] of panes.entries()) {
    await sendToTerminal(
      page,
      pane.ptyId,
      `node ${JSON.stringify(scriptPath)} ${index} ${LOAD_RATE_KBPS} ${LOAD_DURATION_S} ${PTY_METADATA ? 1 : 0} ${readPositiveInt('OCC_TYPING_BENCH_TITLE_CHANGE_MS', 0)} ${readPositiveInt('OCC_TYPING_BENCH_LIFECYCLE_MS', 0)}\r`
    )
  }
  // Signal readiness through files: concurrent streaming panes can scroll READY out before sequential buffer checks.
  const missingReadyPanes = (): number[] =>
    panes
      .map((_, index) => index)
      .filter((index) => !existsSync(sustainedLoadReadyFilePath(readyFileDirectory, runId, index)))
  await expect
    .poll(() => missingReadyPanes().length, {
      timeout: 30_000,
      message: `load panes never signalled ready: ${missingReadyPanes().join(', ')}`
    })
    .toBe(0)
}

function removeLoadReadyFiles(directory: string, runId: string, paneCount: number): void {
  for (let index = 0; index < paneCount; index++) {
    rmSync(sustainedLoadReadyFilePath(directory, runId, index), { force: true })
    rmSync(path.join(directory, `.occ-mwt-load-stats-${runId}-${index}`), { force: true })
  }
}

test.describe('Multi-workspace sustained typing latency bench', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(10 * 60 * 1000)
  // Group scope, not the test bodies: a body-level skip still builds the Electron fixtures.
  test.skip(!BENCH_ENABLED, 'Bench-only: run via pnpm bench:multi-workspace-typing')

  test('baseline: paced typing with no agent load', async ({
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
    try {
      await resetDeliveryDebug(occPage)
      await startTypingProbe(occPage, typingPtyId, probePath, runId)
      const measured = await measureTypingWindow(occPage, runId, sidecarPath)
      const { measurement } = measured
      writeBenchReport(
        testInfo,
        'baseline',
        measured,
        { cpuWorkers: 0, ptyMetadata: false, statusTrafficModel: null },
        await readSchedulerDebug(occPage),
        await readMainDeliveryDebug(occPage)
      )
      expect(measurement.inputHalfMs?.count).toBe(KEY_COUNT)
      expect(measurement.totalMs?.count).toBe(KEY_COUNT)
      expect(measurement.totalMs?.p50 ?? Number.POSITIVE_INFINITY).toBeLessThan(250)
    } finally {
      await stopPtysQuietly(occPage, [typingPtyId])
      rmSync(probePath, { force: true })
      rmSync(sidecarPath, { force: true })
    }
  })

  test('typing under sustained hidden multi-workspace agent load', async ({
    electronApp,
    occPage
  }, testInfo) => {
    await waitForSessionReady(occPage)
    const typingWorktreeId = await waitForActiveWorktree(occPage)
    const loadWorktreeId = (await getAllWorktreeIds(occPage)).find((id) => id !== typingWorktreeId)
    expect(Boolean(loadWorktreeId), 'bench needs the seeded secondary worktree').toBe(true)
    if (!loadWorktreeId) {
      return
    }

    const scratch = mkdtempSync(path.join(tmpdir(), 'occ-typing-load-'))
    const runId = randomUUID()
    const loadPath = path.join(scratch, `.occ-mwt-load-${runId}.mjs`)
    const probePath = path.join(scratch, `.occ-mwt-probe-${runId}.mjs`)
    const sidecarPath = path.join(scratch, `.occ-mwt-arrivals-${runId}.jsonl`)
    writeSustainedAgentLoadScript(loadPath, runId, scratch)
    writeTypingEchoProbeScript(probePath, runId, sidecarPath)

    const cpuWorkers = spawnCpuPressureWorkers()
    let loadPanes: TerminalLoadPane[] = []
    const createdWorktreeIds: string[] = []
    let titleWorkload: { registeredTabs: number; registeredPanes: number } | null = null
    let statusTrafficStarted = false
    let orderTrafficStarted = false
    let instrumentationAvailable = false
    let graphProbeStart: { main: string; renderer: string } | null = null
    let graphProbeSelfTest: RendererLongTaskSelfTestWindow | null = null
    let statusIngressValidation: AccumulatedStatusIngressValidation | null = null
    try {
      await switchToWorktree(occPage, loadWorktreeId)
      loadPanes = await createTypingLoadWorkspaces(
        occPage,
        loadWorktreeId,
        LOAD_PANES,
        LOAD_WORKSPACES,
        readPositiveInt('OCC_TYPING_BENCH_VISITED_WORKSPACES', LOAD_WORKSPACES),
        createdWorktreeIds
      )
      await startSustainedLoadInPanes(occPage, loadPanes, loadPath, runId, scratch)

      await switchToWorktree(occPage, typingWorktreeId)
      await expect
        .poll(() => getActiveWorktreeId(occPage), { timeout: 10_000 })
        .toBe(typingWorktreeId)
      await ensureTerminalVisible(occPage)
      await waitForActiveTerminalManager(occPage, 30_000)
      const typingPtyId = await waitForActivePanePtyId(occPage)

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
      console.log(`[multi-workspace-typing] accumulated fixture: ${JSON.stringify(fixtureSummary)}`)
      const statusTrafficEnabled =
        !PTY_METADATA && process.env.OCC_TYPING_BENCH_METADATA_STATUS !== '0'
      if (statusTrafficEnabled) {
        statusIngressValidation = await validateAccumulatedStatusIpcIngress(electronApp, occPage)
        const validationPaneCount = Math.min(3, fixtureSummary.liveStatuses)
        expect(statusIngressValidation).toEqual({
          burstEvents: validationPaneCount,
          staggeredEvents: validationPaneCount
        })
      }
      if (BENCH_INSTRUMENTATION_REQUESTED) {
        instrumentationAvailable = await startAccumulatedBenchmarkInstrumentation(occPage)
      }
      if (GRAPH_PROBE_REQUESTED) {
        graphProbeStart = await startRuntimeGraphPublicationProbe(electronApp, occPage)
        if (GRAPH_PROBE_SELF_TEST_MS > 0) {
          graphProbeSelfTest = await injectRendererLongTaskSelfTest(
            occPage,
            GRAPH_PROBE_SELF_TEST_MS
          )
        }
        console.log(`[multi-workspace-typing] graph probe: ${JSON.stringify(graphProbeStart)}`)
      }
      if (statusTrafficEnabled) {
        const statusTraffic = await startAccumulatedStatusTraffic(
          electronApp,
          occPage,
          readPositiveInt('OCC_TYPING_BENCH_METADATA_STATUS_INTERVAL_MS', 100)
        )
        expect(statusTraffic.trackedStatuses).toBe(fixtureSummary.liveStatuses)
        statusTrafficStarted = true
      }
      if (!PTY_METADATA && process.env.OCC_TYPING_BENCH_METADATA_TITLES === '1') {
        titleWorkload = await startAccumulatedTitleTraffic(occPage, 100)
        console.log(
          `[multi-workspace-typing] registered title workload: ${JSON.stringify(titleWorkload)}`
        )
      }

      if (ORDER_CHURN_MS > 0) {
        const orderedRepos = await startAccumulatedOrderTraffic(occPage, ORDER_CHURN_MS)
        expect(orderedRepos).toBe(fixtureSummary.repositories)
        orderTrafficStarted = true
      }

      await resetDeliveryDebug(occPage)
      // Hidden-byte drops prove load flows through the background-worktree delivery gate.
      await expect
        .poll(
          async () => (await readMainDeliveryDebug(occPage))?.hiddenDeliveryDroppedChars ?? 0,
          { timeout: 30_000, message: 'hidden load never started flowing' }
        )
        .toBeGreaterThan(0)

      if (PTY_METADATA) {
        await expect
          .poll(
            () =>
              occPage.evaluate(
                () =>
                  Object.values(window.__store?.getState().agentStatusByPaneKey ?? {}).filter(
                    (row) => row.prompt === 'Synthetic production-path typing workload'
                  ).length
              ),
            { timeout: 30_000 }
          )
          .toBe(LOAD_PANES)
      }
      await startTypingProbe(occPage, typingPtyId, probePath, runId)
      const measured = await measureTypingWindow(occPage, runId, sidecarPath)
      const { measurement } = measured
      const orderWorkload = orderTrafficStarted ? await stopAccumulatedOrderTraffic(occPage) : null
      orderTrafficStarted = false
      if (orderWorkload) {
        expect(orderWorkload.publications).toBeGreaterThan(0)
      }
      const statusWorkload = statusTrafficStarted
        ? await stopAccumulatedStatusTraffic(electronApp, occPage)
        : null
      statusTrafficStarted = false
      if (statusWorkload) {
        // Require controller presence before equalities that an all-zero result would satisfy.
        expect(statusWorkload.generatedUpdates).toBeGreaterThan(0)
        expect(statusWorkload.trackedStatuses).toBeGreaterThan(0)
        expect(statusWorkload.acceptedUpdates).toBe(statusWorkload.generatedUpdates)
        expect(statusWorkload.latestReceipts).toBe(statusWorkload.trackedStatuses)
      }
      const instrumentation = BENCH_INSTRUMENTATION_REQUESTED
        ? await stopAccumulatedBenchmarkInstrumentation(occPage)
        : { available: false as const, reason: 'disabled' as const, snapshot: null }
      instrumentationAvailable = false
      const graphProbe = graphProbeStart
        ? await stopRuntimeGraphPublicationProbe(
            electronApp,
            occPage,
            graphProbeStart,
            graphProbeSelfTest
          )
        : null
      graphProbeStart = null
      writeBenchReport(
        testInfo,
        `hidden-load-${LOAD_PANES}x${LOAD_RATE_KBPS}kbps-cpu${CPU_WORKERS}${ORDER_CHURN_MS > 0 ? `-order${ORDER_CHURN_MS}ms` : ''}`,
        measured,
        {
          cpuWorkers: cpuWorkers.length,
          ptyMetadata: PTY_METADATA,
          statusTrafficModel: PTY_METADATA
            ? 'pty-osc-through-runtime-and-ipc-bridge'
            : statusWorkload
              ? 'electron-ipc-burst-through-production-bridge'
              : null
        },
        await readSchedulerDebug(occPage),
        await readMainDeliveryDebug(occPage),
        instrumentation,
        titleWorkload,
        statusWorkload,
        statusIngressValidation,
        await readTypingScaleCensus(occPage),
        fixtureSummary,
        {
          producers: loadPanes.map((_, index) =>
            JSON.parse(
              readFileSync(path.join(scratch, `.occ-mwt-load-stats-${runId}-${index}`), 'utf8')
            )
          ),
          receipts: await occPage.evaluate(() => {
            const state = window.__store?.getState()
            return {
              statuses: Object.values(state?.agentStatusByPaneKey ?? {})
                .filter((row) => row.prompt === 'Synthetic production-path typing workload')
                .map((row) => ({
                  sequence: row.acceptedStatusSeq,
                  providerSession: row.providerSession,
                  state: row.state,
                  message: row.lastAssistantMessage
                })),
              titles: Object.values(state?.runtimePaneTitlesByTabId ?? {}).flatMap(Object.values),
              agentRowsMode: state?.agentActivityDisplayMode,
              renderedAgentRows: document.querySelectorAll(
                '.worktree-agent-row-hover, .compact-agent-row'
              ).length
            }
          })
        },
        graphProbe,
        null,
        null,
        orderWorkload
      )
      const screenDirectory = path.resolve('.tmp', 'typing-reproduction')
      mkdirSync(screenDirectory, { recursive: true })
      await occPage.screenshot({ path: path.join(screenDirectory, `${BENCH_LABEL}-screen.png`) })
      // Timeout catches hangs only; report regressions through JSON percentiles.
      expect(measurement.inputHalfMs?.count).toBe(KEY_COUNT)
      expect(measurement.totalMs?.count).toBe(KEY_COUNT)

      await stopPtysQuietly(occPage, [typingPtyId])
    } finally {
      if (orderTrafficStarted) {
        await stopAccumulatedOrderTraffic(occPage).catch(() => null)
      }
      if (instrumentationAvailable) {
        await stopAccumulatedBenchmarkInstrumentation(occPage).catch(() => undefined)
      }
      if (graphProbeStart) {
        await stopRuntimeGraphPublicationProbe(
          electronApp,
          occPage,
          graphProbeStart,
          graphProbeSelfTest
        ).catch(() => undefined)
      }
      if (statusTrafficStarted) {
        await stopAccumulatedStatusTraffic(electronApp, occPage)
      }
      await stopAccumulatedTitleTraffic(occPage)
      await cleanupAccumulatedWorkspaceFixture(occPage)
      for (const worker of cpuWorkers) {
        worker.kill('SIGKILL')
      }
      await switchToWorktree(occPage, loadWorktreeId).catch(() => undefined)
      await stopPtysQuietly(
        occPage,
        loadPanes.map((pane) => pane.ptyId)
      )
      await switchToWorktree(occPage, typingWorktreeId).catch(() => undefined)
      rmSync(loadPath, { force: true })
      rmSync(probePath, { force: true })
      rmSync(sidecarPath, { force: true })
      removeLoadReadyFiles(scratch, runId, LOAD_PANES)
      await removeTypingLoadWorkspaces(occPage, createdWorktreeIds)
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test('typing under sustained visible split agent load', async ({
    occPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)

    const runId = randomUUID()
    const loadPath = path.join(testRepoPath, `.occ-mwt-load-${runId}.mjs`)
    const probePath = path.join(testRepoPath, `.occ-mwt-probe-${runId}.mjs`)
    const sidecarPath = path.join(testRepoPath, `.occ-mwt-arrivals-${runId}.jsonl`)
    writeSustainedAgentLoadScript(loadPath, runId, testRepoPath)
    writeTypingEchoProbeScript(probePath, runId, sidecarPath)

    const cpuWorkers = spawnCpuPressureWorkers()
    let panes: TerminalLoadPane[] = []
    try {
      // Type in pane 0 while adjacent panes stream, matching a visible agent split.
      panes = await ensureActiveWorktreePaneLoad(occPage, 2)
      const [typingPane, ...loadPanes] = panes
      await startSustainedLoadInPanes(occPage, loadPanes, loadPath, runId, testRepoPath)
      await focusPane(occPage, typingPane.paneKey)

      await resetDeliveryDebug(occPage)
      await startTypingProbe(occPage, typingPane.ptyId, probePath, runId)
      const measured = await measureTypingWindow(occPage, runId, sidecarPath)
      const { measurement } = measured
      writeBenchReport(
        testInfo,
        `visible-split-${LOAD_RATE_KBPS}kbps-cpu${CPU_WORKERS}`,
        measured,
        {
          cpuWorkers: cpuWorkers.length,
          ptyMetadata: PTY_METADATA,
          statusTrafficModel: PTY_METADATA ? 'pty-osc-through-runtime-and-ipc-bridge' : null
        },
        await readSchedulerDebug(occPage),
        await readMainDeliveryDebug(occPage)
      )
      expect(measurement.inputHalfMs?.count).toBe(KEY_COUNT)
      expect(measurement.totalMs?.count).toBe(KEY_COUNT)
    } finally {
      for (const worker of cpuWorkers) {
        worker.kill('SIGKILL')
      }
      await stopPtysQuietly(
        occPage,
        panes.map((pane) => pane.ptyId)
      )
      rmSync(loadPath, { force: true })
      rmSync(probePath, { force: true })
      rmSync(sidecarPath, { force: true })
      removeLoadReadyFiles(testRepoPath, runId, panes.length)
    }
  })

  // Require --git-churn-repos: main’s git subprocess polling competes with PTY relay on the same event loop.
  // Without it this would duplicate the visible-split scenario.
  test('typing under sustained git-subprocess churn', async ({
    occPage,
    testRepoPath
  }, testInfo) => {
    test.skip(
      GIT_CHURN_REPOS === 0,
      'Set --git-churn-repos to run: this scenario measures git-spawn churn, not PTY bytes'
    )
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)

    const runId = randomUUID()
    const loadPath = path.join(testRepoPath, `.occ-mwt-load-${runId}.mjs`)
    const probePath = path.join(testRepoPath, `.occ-mwt-probe-${runId}.mjs`)
    const sidecarPath = path.join(testRepoPath, `.occ-mwt-arrivals-${runId}.jsonl`)
    const churnRoot = mkdtempSync(path.join(tmpdir(), 'occ-git-churn-'))
    writeSustainedAgentLoadScript(loadPath, runId, testRepoPath)
    writeTypingEchoProbeScript(probePath, runId, sidecarPath)

    const cpuWorkers = spawnCpuPressureWorkers()
    let panes: TerminalLoadPane[] = []
    let gitChurn: GitChurnStats | null = null
    try {
      const repos = createGitChurnRepos(churnRoot, GIT_CHURN_REPOS, GIT_CHURN_FILES)
      const registration = await registerGitChurnRepos(
        occPage,
        repos.map((repo) => repo.path)
      )
      expect(
        registration,
        `churn repos were not registered with OCC: ${registration.failures.join('; ')}`
      ).toMatchObject({ registered: repos.length })
      panes = await ensureActiveWorktreePaneLoad(occPage, 2)
      const [typingPane, ...loadPanes] = panes
      await startSustainedLoadInPanes(occPage, loadPanes, loadPath, runId, testRepoPath)
      await focusPane(occPage, typingPane.paneKey)

      await resetDeliveryDebug(occPage)
      await startTypingProbe(occPage, typingPane.ptyId, probePath, runId)
      await startGitChurnLoad(
        occPage,
        repos.map((repo) => repo.path),
        { concurrency: GIT_CHURN_CONCURRENCY, admissionTier: 'status' }
      )
      const measured = await measureTypingWindow(occPage, runId, sidecarPath)
      gitChurn = await stopGitChurnLoad(occPage)
      const { measurement } = measured
      writeBenchReport(
        testInfo,
        `git-churn-${GIT_CHURN_REPOS}repos-x${GIT_CHURN_CONCURRENCY}`,
        measured,
        {
          cpuWorkers: cpuWorkers.length,
          ptyMetadata: PTY_METADATA,
          statusTrafficModel: PTY_METADATA ? 'pty-osc-through-runtime-and-ipc-bridge' : null
        },
        await readSchedulerDebug(occPage),
        await readMainDeliveryDebug(occPage),
        undefined,
        null,
        null,
        null,
        undefined,
        undefined,
        undefined,
        null,
        gitChurn
      )
      // Require spawned git children; rejection-only loops cannot measure subprocess churn.
      expect(gitChurn?.settled ?? 0).toBeGreaterThan(0)
      expect(
        gitChurn,
        `git churn never reached git: ${gitChurn?.firstError ?? 'unknown error'}`
      ).toMatchObject({ failed: 0 })
      expect(measurement.inputHalfMs?.count).toBe(KEY_COUNT)
      expect(measurement.totalMs?.count).toBe(KEY_COUNT)
    } finally {
      await stopGitChurnLoad(occPage).catch(() => null)
      for (const worker of cpuWorkers) {
        worker.kill('SIGKILL')
      }
      await stopPtysQuietly(
        occPage,
        panes.map((pane) => pane.ptyId)
      )
      rmSync(loadPath, { force: true })
      rmSync(probePath, { force: true })
      rmSync(sidecarPath, { force: true })
      rmSync(churnRoot, { recursive: true, force: true })
      removeLoadReadyFiles(testRepoPath, runId, panes.length)
    }
  })

  // Measure render gaps for synchronized-output foreground repaint under background load.
  // A delayed closing ?2026l can suppress rows until xterm’s 1000ms force-flush while buffer-only observations report fast echo.
  test('typing a DEC 2026 foreground TUI under agent load, measured at the render', async ({
    occPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
    await ensureTerminalVisible(occPage)
    await waitForActiveTerminalManager(occPage, 30_000)

    const runId = randomUUID()
    const loadPath = path.join(testRepoPath, `.occ-mwt-load-${runId}.mjs`)
    const probePath = path.join(testRepoPath, `.occ-mwt-probe-${runId}.mjs`)
    const sidecarPath = path.join(testRepoPath, `.occ-mwt-arrivals-${runId}.jsonl`)
    writeSustainedAgentLoadScript(loadPath, runId, testRepoPath)
    writeCodexEchoProbeScript(probePath, runId, sidecarPath, {
      frameRows: CODEX_FRAME_ROWS,
      splitDelayMs: CODEX_SPLIT_DELAY_MS
    })

    const cpuWorkers = spawnCpuPressureWorkers()
    let panes: TerminalLoadPane[] = []
    let blackout: SynchronizedOutputBlackoutSnapshot | null = null
    try {
      panes = await ensureActiveWorktreePaneLoad(occPage, Math.max(2, LOAD_PANES + 1))
      const [typingPane, ...loadPanes] = panes
      await startSustainedLoadInPanes(occPage, loadPanes, loadPath, runId, testRepoPath)
      await focusPane(occPage, typingPane.paneKey)

      await resetDeliveryDebug(occPage)
      await startTypingProbe(occPage, typingPane.ptyId, probePath, runId)
      const activeTabId = await getActiveTabId(occPage)
      const probeInstall = await startSynchronizedOutputBlackoutProbe(occPage, activeTabId ?? '')
      // Require probe installation so missing instrumentation cannot report a false zero-blackout success.
      expect(probeInstall, `blackout probe not installed: ${probeInstall.reason}`).toMatchObject({
        installed: true
      })

      const measured = await measureTypingWindow(occPage, runId, sidecarPath)
      blackout = await stopSynchronizedOutputBlackoutProbe(occPage)
      const { measurement } = measured
      writeBenchReport(
        testInfo,
        `dec2026-render-${LOAD_PANES}panes-${LOAD_RATE_KBPS}kbps-rows${CODEX_FRAME_ROWS}`,
        measured,
        {
          cpuWorkers: cpuWorkers.length,
          ptyMetadata: PTY_METADATA,
          statusTrafficModel: PTY_METADATA ? 'pty-osc-through-runtime-and-ipc-bridge' : null
        },
        await readSchedulerDebug(occPage),
        await readMainDeliveryDebug(occPage),
        undefined,
        null,
        null,
        null,
        await readTypingScaleCensus(occPage).catch(() => null),
        undefined,
        undefined,
        null,
        null,
        blackout
      )
      expect(measurement.totalMs?.count).toBe(KEY_COUNT)
      expect(blackout?.renderCount ?? 0).toBeGreaterThan(0)
    } finally {
      await stopSynchronizedOutputBlackoutProbe(occPage).catch(() => null)
      for (const worker of cpuWorkers) {
        worker.kill('SIGKILL')
      }
      await stopPtysQuietly(
        occPage,
        panes.map((pane) => pane.ptyId)
      )
      rmSync(loadPath, { force: true })
      rmSync(probePath, { force: true })
      rmSync(sidecarPath, { force: true })
      removeLoadReadyFiles(testRepoPath, runId, panes.length)
    }
  })
})
