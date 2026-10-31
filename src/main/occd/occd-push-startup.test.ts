import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProfilePreferences } from '../persistence/loading-store/profile-preferences'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { DeviceRegistry } from '../runtime/device-registry'
import { RuntimeMobileNotificationController } from '../runtime/runtime-mobile-notification-controller'
import { PushUnregisterOutbox } from '../runtime/push/push-unregister-outbox'
import { createPushHostKeypair } from '../runtime/push/push-host-challenge-fixtures'
import { acquireProfileStateMaintenance } from '../persistence/profile-state/profile-state-access'
import { profileStateAccessPaths } from '../persistence/profile-state/profile-state-access-owner'

const state = vi.hoisted(() => ({
  root: '',
  controller: null as RuntimeMobileNotificationController | null,
  registry: null as DeviceRegistry | null,
  rpcStarted: false,
  profileStartupErrors: new Array<Error>(),
  onSettingsChanged: vi.fn<ProfilePreferences['onSettingsChanged']>(),
  removeSettingsListener: vi.fn(),
  startDaemon: vi.fn(async () => {}),
  stopDaemon: vi.fn(async () => {}),
  browserProvider: vi.fn(async () => null),
  register: vi.fn(async () => ({ ok: true, registrationId: 'headless-registration' })),
  send: vi.fn(async () => ({ ok: true, results: [] })),
  startCodexHooks: vi.fn(),
  installManagedAgentHooks: vi.fn(async () => []),
  refreshOpenCodePlugins: vi.fn(),
  adoptLoginShellAgentHomes: vi.fn(async () => {})
}))
const codexStart = vi.hoisted(() => {
  const value: { settledAtPublish: boolean | null } = { settledAtPublish: null }
  return value
})
const profile = vi.hoisted(() => {
  const value: { settings: Partial<GlobalSettings> } = { settings: {} }
  return value
})
// Reconciliation writes user-global agent configs; isolate it from the real home.
vi.mock('../codex/codex-hook-reconcile', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startCodexHooks: state.startCodexHooks
}))
vi.mock('../agent-hooks/managed-agent-hook-controls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installManagedAgentHooks: state.installManagedAgentHooks
}))
vi.mock('../agent-hooks/local-agent-cli-presence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hydrateAgentCliShellPath: async () => {}
}))
vi.mock('../agent-hooks/agent-home-login-shell', () => ({
  adoptLoginShellAgentHomes: state.adoptLoginShellAgentHomes
}))
vi.mock('../claude/agent-view-service', () => ({
  getClaudeAgentViewService: () => ({ reconcile: async () => {} })
}))
vi.mock('../opencode/opencode-status-plugin-startup-refresh', () => ({
  refreshInstalledOpenCodeStatusPlugins: state.refreshOpenCodePlugins
}))
vi.mock('./occd-app-paths', () => ({
  resolveOCCdInstallRoot: () => state.root,
  resolveOCCdPath: () => state.root,
  resolveUserDataPath: () => state.root
}))
// Migration otherwise targets the real credential directory.
vi.mock('./occd-plaintext-credential-migration', () => ({
  occdCredentialRoot: () => state.root,
  migratePlaintextCredentials: () => ({ sealed: 0, failed: 0 })
}))
vi.mock('./occd-account-services', () => ({ createOCCdAccountServices: () => null }))
vi.mock('./occd-browser-provider', () => ({ resolveOCCdBrowserProvider: state.browserProvider }))
vi.mock('./occd-instance-lock', () => ({
  acquireOCCdInstanceLock: () => ({
    path: join(state.root, 'occd.lock'),
    record: { pid: process.pid, startedAtMs: null, nonce: 'headless-instance' },
    release() {}
  })
}))
vi.mock('./occd-daemon-supervision', () => ({
  startOCCdDaemon: state.startDaemon,
  stopOCCdDaemon: state.stopDaemon
}))
vi.mock('./occd-health', () => ({ collectOCCdHealth: async () => ({}) }))
vi.mock('./occd-automations', () => ({
  startOCCdAutomations: () => {},
  stopOCCdAutomationScheduler: () => {},
  occdAutomationsKeepHostBusy: () => false
}))
// Prevent network rule downloads in this unit test.
vi.mock('../runtime/agent-state-rules/agent-state-rules-live-update', () => ({
  startAgentStateRulesLiveUpdates: () => {}
}))
vi.mock('../daemon/daemon-provider-state', () => ({ daemonOwnsFreshPersistentPtys: () => false }))
vi.mock('../ipc/pty/register-headless-runtime', () => ({
  registerHeadlessPtyRuntime: async () => {}
}))
vi.mock('../ipc/pty/provider/registry', () => ({ getLocalPtyProvider: () => null }))
vi.mock('./occd-profile-state-startup', () => ({
  createOCCdProfileStateStartup: async () => {
    const error = state.profileStartupErrors.shift()
    if (error) {
      throw error
    }
    return {
      store: {
        getSettings: () => profile.settings,
        onSettingsChanged: state.onSettingsChanged,
        flushFinalOrThrowAsync: async () => {},
        freezeWritesAsync: async () => {}
      },
      authority: {
        backend: 'sqlite',
        classification: 'neither',
        authority_mode: 'sqlite-candidate',
        runtime: 'occd',
        migrated: false
      }
    }
  }
}))
vi.mock('../occ-profiles/profile-index-store', () => ({
  initOCCProfilePaths() {},
  ensureActiveOCCProfile: () => ({
    dataFile: join(state.root, 'profile.json'),
    stateDatabaseFile: join(state.root, 'profile-state.db'),
    profile: { id: 'headless-profile' }
  })
}))
vi.mock('../ssh/ssh-host-key-store', () => ({ initSshHostKeyStoreFile() {} }))
vi.mock('../server/serve-readiness', () => ({
  ServeReadinessPublisher: class {
    async publish() {
      const startAfter: Promise<void> | undefined =
        state.startCodexHooks.mock.calls[0]?.[0]?.startAfter
      if (startAfter) {
        let settled = false
        void startAfter.then(() => {
          settled = true
        })
        await new Promise((resolve) => setImmediate(resolve))
        codexStart.settledAtPublish = settled
      }
    }
  }
}))
vi.mock('../runtime/occ-runtime', () => ({
  OCCRuntimeService: class {
    readonly sidebarFacts = null
    readonly agentTransitions = { seedRestoredRows() {} }
    attachAgentStatusStore() {
      return () => {}
    }
    setEmulatorBridge() {}
    getRuntimeId() {
      return 'headless-runtime'
    }
    rehydrateClientHostedBrowserPages() {}
    restoreHostAccountLaunchEnv() {}
    async refreshRestoredOrchestrationAuthority() {}
    async reconcileLegacyWorkerTerminals() {}
    async installPendingOCCdMigrationShellHistory() {}
    async stopLegacyWorkerTerminalRecovery() {}
    async closeNotificationDismissals() {}
    flushPaneGrids() {
      return null
    }
    syncWindowGraph() {}
    setMobilePushRegistrar(
      registrar: Parameters<RuntimeMobileNotificationController['setPushRegistrar']>[0]
    ) {
      state.controller!.setPushRegistrar(registrar)
    }
    onNotificationDispatched(
      listener: Parameters<RuntimeMobileNotificationController['onDispatched']>[0]
    ) {
      return state.controller!.onDispatched(listener)
    }
  }
}))
vi.mock('../runtime/runtime-rpc', () => ({
  OCCRuntimeRpcServer: class {
    async start() {
      state.rpcStarted = true
    }
    async stop() {
      state.rpcStarted = false
    }
    getWebSocketEndpoint() {
      return null
    }
    getE2EEKeypair() {
      expect(state.rpcStarted).toBe(true)
      return createPushHostKeypair()
    }
    getDeviceRegistry() {
      return state.registry
    }
    getPushUnregisterOutbox() {
      return new PushUnregisterOutbox(state.root)
    }
    setOnPushUnregisterQueued() {}
  }
}))
vi.mock('../runtime/push/push-gateway-client', () => ({
  PushGatewayClient: class {
    registerDevice = state.register
    send = state.send
    async deleteDevice() {
      return { deleted: true, retryable: false }
    }
  }
}))

beforeEach(() => {
  // Restore the prior data-root env after startOCCd canonicalizes it.
  vi.stubEnv('OCC_USER_DATA_PATH', '')
  state.onSettingsChanged.mockReturnValue(state.removeSettingsListener)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(state.root, { recursive: true, force: true })
  state.profileStartupErrors.length = 0
  profile.settings = {}
  codexStart.settledAtPublish = null
  vi.clearAllMocks()
})

it('refuses recovery overlap before initializing the browser provider or runtime', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-recovery-'))
  const maintenance = acquireProfileStateMaintenance(state.root)
  const { startOCCd, parseArgs } = await import('./occd-entry')
  const commandArguments = await import('./occd-command-arguments')
  try {
    expect(parseArgs).toBe(commandArguments.parseArgs)
    await expect(startOCCd({ noPairing: true, json: true })).rejects.toThrow()
    expect(state.browserProvider).not.toHaveBeenCalled()
    expect(state.rpcStarted).toBe(false)
  } finally {
    maintenance.release()
  }
})

it('starts push after RPC identity is available and stops dispatch on shutdown', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-push-'))
  state.controller = new RuntimeMobileNotificationController()
  state.registry = new DeviceRegistry(state.root)
  const phone = state.registry.addDevice('headless-phone', 'mobile')
  const { startOCCd } = await import('./occd-entry')
  const host = await startOCCd({ noPairing: true, json: true })
  try {
    const result = await state.controller.registerPushDevice({
      deviceId: phone.deviceId,
      platform: 'android',
      token: 'test-token',
      filter: {
        onlyWhenDesktopAway: true
      }
    })
    expect(result).toMatchObject({ registered: true })
    expect(state.registry.getDevice(phone.deviceId)?.pushRegistration?.expiresAt).toBeGreaterThan(
      Date.now()
    )
    state.controller.dispatch({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'QA',
      body: 'QA'
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.send).toHaveBeenCalledTimes(1)
  } finally {
    await host.stop()
  }
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
  expect(state.controller.getListenerCount()).toBe(0)
  expect(state.rpcStarted).toBe(false)
  expect(state.onSettingsChanged).toHaveBeenCalledOnce()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  await host.stop()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  expect(await state.controller.registerPushDevice({} as never)).toMatchObject({
    registered: false
  })
})

it('releases admission when host setup fails before a runtime exists', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-setup-failure-'))
  state.profileStartupErrors.push(new Error('profile startup failed'))
  const { startOCCd } = await import('./occd-entry')
  await expect(startOCCd()).rejects.toThrow('profile startup failed')
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
})

it('serves RPC without waiting for browser discovery', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-browser-pending-'))
  let finishDiscovery!: () => void
  state.browserProvider.mockReturnValueOnce(
    new Promise<null>((resolve) => {
      finishDiscovery = () => resolve(null)
    })
  )
  const { startOCCd } = await import('./occd-entry')
  const host = await startOCCd({ noPairing: true, json: true })
  expect(host.managedStop).toMatchObject({
    runtimeId: 'headless-runtime',
    instance: { pid: process.pid, nonce: 'headless-instance' }
  })
  finishDiscovery()
  await host.stop()
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
})

it('unsubscribes settings when daemon startup fails after hook setup', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-daemon-failure-'))
  state.startDaemon.mockRejectedValueOnce(new Error('daemon setup failed'))
  const { startOCCd } = await import('./occd-entry')
  await expect(startOCCd()).rejects.toThrow('daemon setup failed')
  expect(state.onSettingsChanged).toHaveBeenCalledOnce()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
})

it('spawns the daemon while the hook server is still starting', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-daemon-parallel-'))
  const { agentHookServer } = await import('../agent-hooks/server')
  const hookStart = Promise.withResolvers<void>()
  const start = vi.spyOn(agentHookServer, 'start').mockReturnValue(hookStart.promise)
  const { startOCCd } = await import('./occd-entry')
  const starting = startOCCd({ noPairing: true, json: true })

  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(state.startDaemon).toHaveBeenCalledOnce())
  hookStart.resolve()

  const host = await starting
  await host.stop()
})

it('disconnects a daemon still spawning only after it settles, when the hook server fails', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-hook-failure-'))
  const daemonSpawn = Promise.withResolvers<void>()
  state.startDaemon.mockReturnValueOnce(daemonSpawn.promise)
  const { agentHookServer } = await import('../agent-hooks/server')
  vi.spyOn(agentHookServer, 'start').mockRejectedValueOnce(new Error('hook port taken'))
  const { startOCCd } = await import('./occd-entry')

  const starting = startOCCd()
  await vi.waitFor(() => expect(state.startDaemon).toHaveBeenCalledOnce())
  // The cleanup waits on the in-flight spawn rather than disconnecting a half-started provider.
  await new Promise((resolve) => setImmediate(resolve))
  expect(state.stopDaemon).not.toHaveBeenCalled()
  daemonSpawn.resolve()

  await expect(starting).rejects.toThrow('hook port taken')
  expect(state.stopDaemon).toHaveBeenCalledOnce()
  acquireProfileStateMaintenance(state.root).release()
})

it('disconnects the daemon when startup throws between its spawn and the stores', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-early-throw-'))
  const observability = await import('./occd-observability')
  vi.spyOn(observability, 'installOCCdObservability').mockImplementationOnce(() => {
    throw new Error('observability init failed')
  })
  const { startOCCd } = await import('./occd-entry')

  await expect(startOCCd()).rejects.toThrow('observability init failed')

  expect(state.startDaemon).toHaveBeenCalledOnce()
  expect(state.stopDaemon).toHaveBeenCalledOnce()
})

it('installs agent status hooks on the host when it starts', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-hooks-'))
  const { startOCCd } = await import('./occd-entry')
  const host = await startOCCd({ noPairing: true, json: true })
  try {
    expect(state.startCodexHooks).toHaveBeenCalledOnce()
    expect(state.startCodexHooks.mock.calls[0]![0].resolveLaunchHome()).toBeNull()
    // Codex's PATH scan waits for readiness to publish, then runs.
    expect(codexStart.settledAtPublish).toBe(false)
    await state.startCodexHooks.mock.calls[0]![0].startAfter
    await vi.waitFor(() =>
      expect(state.installManagedAgentHooks).toHaveBeenCalledWith(
        profile.settings,
        expect.objectContaining({ shouldHydrateShellPath: true })
      )
    )
    expect(state.refreshOpenCodePlugins).toHaveBeenCalledWith(profile.settings)
    expect(state.adoptLoginShellAgentHomes.mock.invocationCallOrder[0]).toBeLessThan(
      state.installManagedAgentHooks.mock.invocationCallOrder[0]!
    )
  } finally {
    await host.stop()
  }
})

it('leaves agent configs alone when status hooks are off', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'occ-headless-hooks-off-'))
  profile.settings = { agentStatusHooksEnabled: false }
  const { startOCCd } = await import('./occd-entry')
  const host = await startOCCd({ noPairing: true, json: true })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.installManagedAgentHooks).not.toHaveBeenCalled()
    expect(state.startCodexHooks.mock.calls[0]![0].isEnabled()).toBe(false)
  } finally {
    await host.stop()
  }
})
