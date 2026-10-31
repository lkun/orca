// Compose the Node-host runtime; paired desktop pages work even without a local browser engine.
import process from 'node:process'
import { getAppEnvironment } from '../../shared/app-environment'
import { resolveOCCdInstallRoot, resolveUserDataPath } from './occd-app-paths'
import { prepareOCCdCliLauncher } from './occd-cli-launcher'
import { installOCCdHostAdapters, runOCCdQuitHandlers } from './occd-host-adapters'
import { prepareOCCdSecretStoreAndMigrate } from './occd-secret-store-startup'
import { describeOCCdBindExposure, resolveOCCdBindHost } from './occd-bind-address'
import {
  flushOCCdProfileStoreForShutdown,
  installOCCdShutdownSignals,
  startOCCdWithHost,
  stopOCCdStructuredAgentSessions,
  type OCCdShutdownTrigger
} from './occd-lifecycle'
import { OCCD_USAGE, parseArgs, resolveOCCdWebClientRoot } from './occd-command-arguments'
import type { OCCdRuntimeCleanup } from './occd-runtime-lifetime'
import { installOCCdStopRequestListeners } from './occd-stop-request-listener'
import { prepareOCCdManagedStop } from './occd-managed-stop-admission'
import { bindOCCdStopTerminalAdmission } from './occd-stop-terminal-admission'
import type { OCCdHandle, OCCdOptions } from './occd-start-contract'
import { beginOCCdIdleExit, bindOCCdIdleShutdown } from './occd-managed-idle-exit-host'
import { occdAutomationsKeepHostBusy, startOCCdAutomations } from './occd-automations'
import { changedAiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import type { AiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import { stampRuntimeSourceEnv } from '../../shared/runtime-source-env'
import { adoptWslHostLoginEnvironmentLogged } from './occd-wsl-host-login-environment'
import { installOCCdProcessErrorGuards } from './occd-process-error-guards'
import { occdWsPortOptions } from './occd-ws-port-policy'
import { createOCCdStartupTiming } from './occd-startup-timing'
import { OCC_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { restoreOCCdTerminalAuthority } from './occd-restored-terminal-authority'
import { installOCCdFeatureReadiness } from '../runtime/rpc/occd-feature-readiness'

export { parseArgs }

let closeOCCdObservability = (): Promise<void> => Promise.resolve()

/** Resolve after transport readiness publishes the desktop-compatible serve payload. */
export async function startOCCd(options: OCCdOptions = {}): Promise<OCCdHandle> {
  installOCCdHostAdapters()
  // Inherited terminal identity must not fence occd’s CLI children to the launching desktop.
  stampRuntimeSourceEnv(process.env, null)
  const userDataPath = resolveUserDataPath()
  // Override inherited data roots so CLI-shared Codex homes resolve on this host.
  process.env.OCC_USER_DATA_PATH = userDataPath
  const { readiness, instance, stop } = await startOCCdWithHost(
    userDataPath,
    (registerCleanup) => startOCCdRuntime(options, registerCleanup),
    async () => {
      try {
        runOCCdQuitHandlers()
      } finally {
        // Close after quit handlers, including failed ones, so their spans reach disk.
        const closing = closeOCCdObservability()
        closeOCCdObservability = () => Promise.resolve()
        await closing
      }
    }
  )
  const version = getAppEnvironment().getVersion()
  return { readiness, managedStop: { version, runtimeId: readiness.runtimeId, instance }, stop }
}

async function startOCCdRuntime(
  options: OCCdOptions,
  registerCleanup: (cleanup: OCCdRuntimeCleanup) => void
): Promise<Pick<OCCdHandle, 'readiness'>> {
  const { time: timed, report: reportStartupTiming } = createOCCdStartupTiming()
  // Overlap login-shell probing with imports and store startup.
  const loginEnvironment = adoptWslHostLoginEnvironmentLogged()
  const { startOCCdDaemon, stopOCCdDaemon } = await import('./occd-daemon-supervision')
  // The daemon and its PTYs inherit the adopted login env and nothing later startup writes, so it
  // spawns as soon as that lands, in parallel with the imports, stores and hook server. Never rejects.
  const daemonStartup = loginEnvironment.then(() => timed('daemon', () => startOCCdDaemon()))
  // Observed now: an early abort may never reach the await below.
  void daemonStartup.catch(() => {})
  // Registered first, so it runs last (cleanups run in reverse) and covers an import that throws
  // mid-spawn. It disconnects without killing daemon PTYs that must survive restart, after an
  // in-flight spawn settles; a failed one leaves only the disconnect to do.
  registerCleanup(() => daemonStartup.catch(() => {}).then(() => stopOCCdDaemon()))
  const { OCCRuntimeService } = await import('../runtime/occ-runtime')
  const { OCCRuntimeRpcServer } = await import('../runtime/runtime-rpc')
  const { registerHeadlessPtyRuntime } = await import('../ipc/pty/register-headless-runtime')
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { installOCCdObservability } = await import('./occd-observability')
  closeOCCdObservability = installOCCdObservability()
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { servePublishMode } = await import('../server/serve-pairing-readiness')
  const { buildOCCdServeReadiness } = await import('./occd-serve-readiness')
  const { createOCCdProfileStateStartup } = await import('./occd-profile-state-startup')
  const { daemonOwnsFreshPersistentPtys } = await import('../daemon/daemon-provider-state')
  const { resolveDaemonSessionScrollbackRows } =
    await import('../daemon/daemon-session-scrollback-window')
  const { collectOCCdHealth } = await import('./occd-health')
  const { agentHookServer } = await import('../agent-hooks/server')
  const { isAgentStatusHooksEnabled } = await import('../agent-hooks/managed-agent-hook-controls')
  const { agentHookRuntimeDeps } = await import('../agent-hooks/agent-hook-runtime-deps')
  const { installHookStatusSessionTabsRepublish } =
    await import('../agent-hooks/hook-status-session-tabs-republish')
  const { startOCCdManagedAgentHooks } = await import('./occd-managed-agent-hooks')
  const { AgentStatusObservedPaneIdentities, AgentStatusObservedPaneIdentityCapture } =
    await import('../runtime/agent-status-observed-pane-identity')

  const { disposeWatcherProcessAndWait } =
    await import('../ipc/filesystem/watcher-process/parcel-watcher-process')

  let paneGridsForShutdown: { flushPaneGrids(): Promise<void> | null } | null = null
  let profileStoreForShutdown:
    | { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> }
    | undefined
  let uninstallHookStatusRepublish = (): void => {}
  let uninstallObservedStatusIdentity = (): void => {}
  // Cleanups run in reverse: RPC, then recovery and watchers, then the final flush; the daemon
  // disconnect, registered above, runs last.
  registerCleanup(() => agentHookServer.stop())
  registerCleanup(() => uninstallHookStatusRepublish())
  registerCleanup(() => uninstallObservedStatusIdentity())
  registerCleanup(async () => {
    // A SQLite-backed occd has no JSON mirror to absorb a debounced write after SIGTERM.
    if (profileStoreForShutdown) {
      await flushOCCdProfileStoreForShutdown(profileStoreForShutdown, paneGridsForShutdown)
    }
  })
  registerCleanup(stopOCCdStructuredAgentSessions)
  registerCleanup(() => disposeWatcherProcessAndWait())
  const { DesktopPushService } = await import('../runtime/push/desktop-push-service')
  const { resolvePushGatewayOrigin } = await import('../runtime/push/push-gateway-origin')

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  const { startEventLoopDelayProbe } = await import('../diagnostics/event-loop-delay-probe')
  startEventLoopDelayProbe('occd', runtimeUserDataPath)
  await timed('cli-launcher', () => prepareOCCdCliLauncher()).catch((error: unknown) => {
    console.warn('[occd] Could not prepare the profile CLI launcher', error)
  })
  const idleExitStartup = beginOCCdIdleExit(runtimeUserDataPath)
  const { occdSessionScannerIdleTimeoutMs } = await import('./occd-session-scanner-idle')
  const scannerIdleTimeoutMs = occdSessionScannerIdleTimeoutMs()
  if (scannerIdleTimeoutMs !== null) {
    const { setAiVaultServiceIdleTimeoutMs } =
      await import('../ai-vault/session-scanner-service-spawn')
    setAiVaultServiceIdleTimeoutMs(scannerIdleTimeoutMs)
  }
  // Initialize sealing before Store load unseals protected settings.
  await timed('secret-store', () => prepareOCCdSecretStoreAndMigrate(runtimeUserDataPath))
  const { store: profileStore, authority: profileStateAuthority } = await timed('profile', () =>
    createOCCdProfileStateStartup(runtimeUserDataPath)
  )
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  const observedStatusCapture = new AgentStatusObservedPaneIdentityCapture(observedPaneIdentities)
  profileStoreForShutdown = profileStore
  uninstallObservedStatusIdentity = agentHookServer.subscribeEnrichedStatus((enriched) =>
    observedStatusCapture.observe(enriched)
  )
  // Subscribe before hooks start so early turns are counted.
  const { startOCCdStats } = await import('./occd-stats')
  const stats = startOCCdStats(runtimeUserDataPath, agentHookServer, registerCleanup)
  await agentHookServer.start({
    env: 'production',
    userDataPath: runtimeUserDataPath,
    statusHooksEnabled: isAgentStatusHooksEnabled(profileStore.getSettings())
  })

  // Reconcile, daemon and runtime all consume this environment.
  await timed('login-env-wait', () => loginEnvironment)
  const managedAgentHooks = startOCCdManagedAgentHooks(
    profileStore,
    (enabled) => agentHookServer.setStatusHooksEnabled(enabled),
    registerCleanup
  )

  // Install the daemon provider before PTY handlers can route their first call.
  await daemonStartup

  // Runtime constructor callbacks use this index only after it is installed.
  let sessionSearch: { apply(settings: AiVaultSearchSettings): void; dispose(): void } | null = null

  const { occdCodexAccountHomes } = await import('./occd-codex-account-homes')
  const codexAccountHomes = occdCodexAccountHomes(
    () => profileStore.getSettings(),
    registerCleanup
  )

  // Gates open where each phase finishes today; RPC starts after all of them (no behavior change).
  const featureReadiness = installOCCdFeatureReadiness()
  const { createOCCdAccountServices } = await import('./occd-account-services')
  const accountLaunch = createOCCdAccountServices({
    store: profileStore,
    setClaudeStatusLineListener: (listener) =>
      agentHookServer.setClaudeStatusLineListener(listener),
    registerCleanup,
    clientCodexHomes: codexAccountHomes
  })

  const { loadAgentSessionClaimSigner } =
    await import('../runtime/agent-session/ownership/agent-session-claim-identity')
  const runtime = new OCCRuntimeService(profileStore, stats, {
    // Persistent signatures let restarted runtimes adopt PTYs owned before restart.
    agentSessionClaimSigner: loadAgentSessionClaimSigner(runtimeUserDataPath, runtimeUserDataPath),
    getAdditionalAiVaultCodexHomePaths: () => [
      ...codexAccountHomes.listSessionHomes(),
      ...(accountLaunch?.listCodexSessionHomes() ?? [])
    ],
    // WSL must retain desktop-pushed CODEX_HOME instead of host-selected resolvers.
    ...accountLaunch?.runtimeDeps,
    ...agentHookRuntimeDeps(agentHookServer, observedPaneIdentities, () =>
      profileStore.getSettings()
    ),
    // Resolve lazily because daemon swaps replace the provider after construction.
    getLocalProvider: () => getLocalPtyProvider(),
    // Read current daemon ownership; failed/degraded launch cannot claim fresh PTY persistence.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Node hosts cannot promote into desktop windows; override the constructor’s openable default.
    getDesktopWindowStatus: () => 'blocked',
    // No renderer reveals from this model; it keeps the daemon's live window, which deeper snapshot reads ask first.
    headlessTerminalScrollbackRows: resolveDaemonSessionScrollbackRows(),
    // Unchanged settings would reconstruct a healthy search index; deduplicate before apply.
    applySessionSearchSettings: (before, after) => {
      const next = changedAiVaultSearchSettings(before, after)
      if (next) {
        sessionSearch?.apply(next)
      }
    }
  })
  paneGridsForShutdown = runtime

  accountLaunch?.attachToRuntime(runtime)
  const { installOCCdEmulatorBridge } = await import('./occd-emulator-bridge')
  installOCCdEmulatorBridge(runtime, registerCleanup)

  // Restore prior desktop-pushed account selection before automations or CLI launches.
  const { restoreOCCdHostAccountLaunchEnv } = await import('./occd-host-account-launch-env-store')
  restoreOCCdHostAccountLaunchEnv(runtime, runtimeUserDataPath)
  featureReadiness.open('accounts')

  const { installOCCdSessionSearchService } = await import('./occd-session-search')
  sessionSearch = await installOCCdSessionSearchService({
    userDataPath: runtimeUserDataPath,
    getSettings: () => profileStore.getSettings()
  })
  getAppEnvironment().onWillQuit(() => sessionSearch?.dispose())
  featureReadiness.open('sessionSearch')

  const { startAgentStateRulesLiveUpdates } =
    await import('../runtime/agent-state-rules/agent-state-rules-live-update')
  startAgentStateRulesLiveUpdates(profileStore, (rules) =>
    console.info(`[occd] agent state rules ${rules.version} (${rules.source})`)
  )
  if (OCC_LAYOUT_OWNER_IS_MAIN) {
    const { repairDuplicatePtyPanesOnStart } = await import('../runtime/moved-pane-owner-rekey')
    // Wait behind earlier writes and persist repair before reconciliation/RPC admission.
    await repairDuplicatePtyPanesOnStart(profileStore, runtime)
  }

  // Status changes must republish session.tabs to paired clients.
  uninstallHookStatusRepublish = installHookStatusSessionTabsRepublish(
    agentHookServer,
    () => runtime
  )
  registerCleanup(runtime.attachAgentStatusStore(agentHookServer))

  // Headless registration threads Store into persistence; account homes prefer client then host selection.
  // WSL has no host selection and keeps the desktop-prepared environment.
  await registerHeadlessPtyRuntime(
    runtime,
    async (target, launchEnv, context) =>
      (await codexAccountHomes.selectLaunchHome(target, launchEnv, context)) ??
      (accountLaunch ? accountLaunch.prepareCodexHome(target, launchEnv, context) : null),
    () => profileStore.getSettings(),
    accountLaunch?.prepareClaudeAuth,
    profileStore,
    accountLaunch?.prepareCodexSessionResume
  )

  // Recover browser/orchestration authority before clients attach to the runtime graph.
  runtime.rehydrateClientHostedBrowserPages()

  await restoreOCCdTerminalAuthority(runtime, timed, featureReadiness)
  runtime.agentTransitions.seedRestoredRows()
  void runtime.sidebarFacts?.reconcileSortStampTiers(getLocalPtyProvider())

  // Run after RPC stops; later dismissal records save synchronously until exit.
  registerCleanup(() => runtime.closeNotificationDismissals())
  // Stop recovery retries before final profile flush.
  registerCleanup(() => runtime.stopLegacyWorkerTerminalRecovery())

  // Recovery establishes terminal/dispatch identities before fencing observations.
  observedStatusCapture.attach(runtime)
  agentHookServer.setCliWriterExecutionMatcher(observedPaneIdentities, runtime)
  // First RPC clients must see a fully published graph.
  const { publishHeadlessRuntimeGraph } = await import('../runtime/headless-runtime-graph')
  publishHeadlessRuntimeGraph(runtime)
  // Only the runtime can identify running shells and install deferred migrated history.
  void runtime.installPendingOCCdMigrationShellHistory().catch((error: unknown) => {
    console.error('[occd-migration] installing pending shell history failed:', error)
  })

  const bindHost = resolveOCCdBindHost(options.bind)
  bindOCCdStopTerminalAdmission(runtime.terminalUpdateAdmission)
  const rpc = new OCCRuntimeRpcServer({
    runtime,
    userDataPath: runtimeUserDataPath,
    enableWebSocket: true,
    // Pin operator exposure across restarts; pairing must not silently widen a loopback bind.
    pinnedBindHost: bindHost,
    webClientRoot: resolveOCCdWebClientRoot(options.webClientRoot),
    ...occdWsPortOptions(options.port)
  })
  // Stop RPC before cleanup can tear down writers and runtime state.
  registerCleanup(() => rpc.stop())
  await timed('rpc', () => rpc.start())
  startOCCdAutomations(runtime, profileStore, registerCleanup)
  const pushService = DesktopPushService.create({
    runtime,
    runtimeRpc: rpc,
    gatewayUrl: resolvePushGatewayOrigin(process.env, getAppEnvironment().isPackaged())
  })
  pushService?.start()
  getAppEnvironment().onWillQuit(() => pushService?.stop())
  console.error(`[occd] ${describeOCCdBindExposure(bindHost)}`)

  const readiness = await buildOCCdServeReadiness({
    options,
    runtimeId: runtime.getRuntimeId(),
    rpc,
    collectHealth: () =>
      collectOCCdHealth(
        getAppEnvironment().getVersion(),
        profileStateAuthority,
        idleExitStartup.previousIdleStop
      )
  })

  await new ServeReadinessPublisher().publish(readiness, servePublishMode(options))
  reportStartupTiming()
  managedAgentHooks.readinessPublished()

  await idleExitStartup.start({
    rpc,
    agentStates: () => agentHookServer.getStatusSnapshot(),
    hasStagedMigration: () => profileStore.hasStagedOCCdMigrationCatalog(),
    automationsBusy: () => occdAutomationsKeepHostBusy(profileStore),
    emulatorsBusy: async () =>
      (await runtime.getEmulatorBridge()?.hasLiveManagedSessions()) ?? false,
    registerCleanup
  })
  return { readiness }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(OCCD_USAGE)
    return
  }
  let shutdownTrigger: OCCdShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installOCCdProcessErrorGuards(() => shutdownTrigger)
  const startup = startOCCd(options)
  const requestShutdown = installOCCdShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installOCCdStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveOCCdInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareOCCdManagedStop
  })
  bindOCCdIdleShutdown(requestShutdown)
}
