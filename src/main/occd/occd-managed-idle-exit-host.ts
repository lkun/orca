import { getAppEnvironment } from '../../shared/app-environment'
import type { RuntimeRpcClientActivity } from '../runtime/runtime-rpc/runtime-rpc-shutdown'
import type { OCCdIdleExitEvidence } from './occd-idle-exit-monitor'
import {
  activationFenceExists,
  createOCCdIdleProbes,
  installOCCdManagedIdleExit,
  resolveOCCdManagedIdleExit,
  type OCCdManagedIdleExitConfig,
  type OCCdManagedIdleExitPorts
} from './occd-managed-idle-exit'
import type { OCCdDaemonRetirement } from './occd-daemon-retirement'
import { recoverDaemonAfterCancelledIdleStop } from './occd-idle-stop-daemon-recovery'
import {
  consumeOCCdIdleStopRecord,
  discardOCCdIdleStopRecord,
  writeOCCdIdleStopRecord
} from './occd-idle-stop-record'
import type { OCCdShutdownTrigger } from './occd-lifecycle'
import {
  idleStopMayReleaseWslHolder,
  requestOCCdWslHolderRelease,
  withdrawOCCdWslHolderRelease
} from './occd-wsl-holder-release'
import type { OCCdIdleStopRecord } from '../../shared/occd-idle-exit'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'

let requestIdleShutdown: OCCdShutdownTrigger | null = null

/** Signal handling binds later; the quiet period must outlast the startup gap. */
export function bindOCCdIdleShutdown(request: OCCdShutdownTrigger): void {
  requestIdleShutdown = request
}

type OCCdIdleExitRuntimePorts = {
  rpc: { readClientActivity(): RuntimeRpcClientActivity }
  agentStates: () => readonly { state: string }[]
  hasStagedMigration: () => boolean
  automationsBusy: () => boolean
  emulatorsBusy: () => Promise<boolean>
  /** Stop the monitor before recording signal-driven shutdown. */
  registerCleanup: (cleanup: () => void) => void
}

/** Under the startup lock, consume previous idle-stop evidence before this run can overwrite it. */
export function beginOCCdIdleExit(userDataPath: string): {
  previousIdleStop: OCCdIdleStopRecord | null | undefined
  start: (ports: OCCdIdleExitRuntimePorts) => Promise<void>
} {
  withdrawOCCdWslHolderRelease(userDataPath)
  const config = resolveOCCdManagedIdleExit(process.env)
  if (!config) {
    return { previousIdleStop: undefined, start: async () => {} }
  }
  const previousIdleStop = consumeOCCdIdleStopRecord(userDataPath)
  if (previousIdleStop) {
    console.error(`[occd] the previous run stopped idle at ${previousIdleStop.stoppedAt}`)
  }
  const version = getAppEnvironment().getVersion()
  return {
    previousIdleStop,
    start: (ports) => startOCCdManagedIdleExit({ ...ports, config, userDataPath, version })
  }
}

async function startOCCdManagedIdleExit(
  input: OCCdIdleExitRuntimePorts & {
    config: OCCdManagedIdleExitConfig
    userDataPath: string
    version: string
  }
): Promise<void> {
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { getCurrentDaemonPid, getDaemonEndpointFacts, isDaemonTerminalAdmissionClosed } =
    await import('../daemon/daemon-provider-state')
  const { countLiveOCCdDaemonSessions, retireOCCdDaemonIfIdle } =
    await import('./occd-daemon-retirement')
  const idleRecord = createIdleStopRecordOwnership(input.userDataPath)
  const hasChatProviders = (): boolean =>
    getStructuredAgentSessionHost()?.hasLoadedProviders() ?? false
  const ports: OCCdManagedIdleExitPorts = {
    readClientActivity: () => input.rpc.readClientActivity(),
    listTerminals: () => getLocalPtyProvider().listProcesses(),
    countDaemonSessions: countLiveOCCdDaemonSessions,
    hasDaemon: () => getDaemonEndpointFacts() !== null,
    agentStates: input.agentStates,
    hasChatProviders,
    hasStagedMigration: input.hasStagedMigration,
    automationsBusy: input.automationsBusy,
    emulatorsBusy: input.emulatorsBusy,
    activationFenceExists
  }
  // Client/terminal evidence is already checked; recheck other work exit would destroy.
  const nonTerminalWorkProbes = createOCCdIdleProbes(input.config, ports).filter(
    (probe) => probe.name !== 'clients' && probe.name !== 'terminals'
  )
  const hasNonTerminalWork = async (): Promise<boolean> => {
    for (const probe of nonTerminalWorkProbes) {
      if (
        (await Promise.resolve()
          .then(probe.read)
          .catch(() => 'unverifiable')) !== 'idle'
      ) {
        return true
      }
    }
    return false
  }
  const dispose = installOCCdManagedIdleExit({
    config: input.config,
    ports,
    stop: async (evidence) => {
      // Replacement must target only the daemon incarnation that agreed to retire.
      const retiringPid = getCurrentDaemonPid()
      const outcome = await stopForIdle(input, evidence, retireOCCdDaemonIfIdle)
      // Clients/providers can return while the retirement reply is pending.
      const activity = input.rpc.readClientActivity()
      if (
        hasChatProviders() ||
        activity.openConnections > 0 ||
        activity.requestsInFlight > 0 ||
        activity.lastRequestAt > evidence.quietSince
      ) {
        discardOCCdIdleStopRecord(input.userDataPath)
        const daemon = await recoverDaemonAfterCancelledIdleStop(outcome, {
          admissionClosed: isDaemonTerminalAdmissionClosed,
          retireAgain: () => retireOCCdDaemonIfIdle(),
          replaceDaemon: async () => {
            if (retiringPid === null) {
              throw new Error('the retiring daemon never identified itself')
            }
            const { restartDaemon } = await import('../daemon/daemon-provider-restart')
            await restartDaemon({ expectedDaemonPid: retiringPid, endpointMayBeGone: true })
          }
        })
        if (daemon === 'serving' || (await hasNonTerminalWork())) {
          return false
        }
        idleRecord.requestShutdown(requestIdleShutdown)
        return true
      }
      if (idleStopMayReleaseWslHolder(process.env, outcome)) {
        try {
          requestOCCdWslHolderRelease(input.userDataPath)
        } catch (error) {
          console.error('[occd] could not release the WSL distro holder:', error)
        }
      }
      idleRecord.requestShutdown(requestIdleShutdown)
      return true
    }
  })
  input.registerCleanup(() => {
    dispose()
    idleRecord.onShutdown()
  })
}

/** Discard failed, overdue and externally superseded idle stops, including cleanup before request completion. */
export function createIdleStopRecordOwnership(userDataPath: string): {
  requestShutdown(request: OCCdShutdownTrigger | null): void
  onShutdown(): void
} {
  let idleOwnsStop = false
  // The holder release rides on the idle stop: a stop that is not idle must not end the distro.
  const discard = (): void => {
    discardOCCdIdleStopRecord(userDataPath)
    withdrawOCCdWslHolderRelease(userDataPath)
  }
  return {
    requestShutdown: (request) => {
      // Cleanup may run before the trigger returns, so establish ownership first.
      idleOwnsStop = true
      if (request?.('idle', discard) !== true) {
        idleOwnsStop = false
        discard()
      }
    },
    onShutdown: () => {
      if (!idleOwnsStop) {
        discard()
      }
    }
  }
}

async function stopForIdle(
  input: { userDataPath: string; version: string },
  evidence: OCCdIdleExitEvidence,
  retireDaemon: () => Promise<OCCdDaemonRetirement>
): Promise<OCCdDaemonRetirement> {
  console.error(`[occd] stopping: no client, terminal or job for ${evidence.timeoutMs}ms`)
  try {
    writeOCCdIdleStopRecord(input.userDataPath, evidence, input.version)
  } catch (error) {
    console.error('[occd] could not record the idle stop:', error)
  }
  // Only the daemon’s atomic empty census can authorize retirement.
  const outcome = await retireDaemon().catch((error: unknown): OCCdDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: String(error)
  }))
  console.error(
    `[occd] terminal daemon on idle stop: ${outcome.retirement}${outcome.reason ? ` (${outcome.reason})` : ''}`
  )
  return outcome
}
