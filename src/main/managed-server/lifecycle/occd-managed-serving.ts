// Restart only proven-stopped slots; unverifiable serving state never proves terminal exit.
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { occdBoundPort } from './occd-managed-bound-port'
import { managedOCCdSlot } from './occd-managed-runtime-context'
import { resolveOCCdRemoteContext } from '../install/occd-remote-context'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import {
  getManagedOCCdCrashLoopBrake,
  wakeManagedOCCdUnlessCrashLooping
} from './occd-managed-crash-loop'

export type OCCdManagedServing =
  | { state: 'serving' }
  /** Forwards must follow the restarted server's bound port. */
  | { state: 'started'; boundPort: number | null }
  | { state: 'unverifiable'; detail: string }

export type OCCdManagedServingInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: OCCdHostTransport
  remotePort: number
  probe: (environment: KnownRuntimeEnvironment, timeoutMs: number) => Promise<boolean>
  answeredAt?: (environmentId: string) => number | null
}

export const MANAGED_OCCD_FENCED_DETAIL =
  'An update, rollback or recovery holds this host; it was not started.'

export const MANAGED_OCCD_NOT_ACTIVATED_DETAIL = 'This host has no activated OCC server to start.'

const PROBE_TIMEOUT_MS = 5_000
// Share connect/tunnel verdicts only for the same transport and port; reboots/rebinds need fresh checks.
const VERDICT_REUSE_MS = 5_000
// Recent control-socket pongs prove serving; stop/reboot/rebind closes that socket.
const LIVE_ANSWER_PROOF_MS = 20_000

type ServingTransport = { connection: OCCdHostTransport; generation: number; remotePort: number }
// Reconnected transports need fresh checks instead of inheriting dropped-connection failures.
type ServingCheck = ServingTransport & { check: Promise<OCCdManagedServing>; settledAt?: number }
const checks = new Map<string, ServingCheck>()

function sameTransport(a: ServingTransport, b: ServingTransport): boolean {
  return (
    a.connection === b.connection && a.generation === b.generation && a.remotePort === b.remotePort
  )
}
export type ManagedOCCdStartListener = {
  starting: (target: SshTarget) => void
  /** Unverifiable results include the reason and log tail. */
  settled: (target: SshTarget, environmentId: string, serving: OCCdManagedServing) => void
}

let startListener: ManagedOCCdStartListener | null = null

export function setManagedOCCdStartListener(listener: ManagedOCCdStartListener | null): void {
  startListener = listener
}

export function ensureManagedOCCdServing(
  input: OCCdManagedServingInput,
  now: () => number = Date.now
): Promise<OCCdManagedServing> {
  const id = input.environment.id
  const transport: ServingTransport = {
    connection: input.connection,
    generation: input.connection.getConnectGeneration(),
    remotePort: input.remotePort
  }
  const entry = checks.get(id)
  if (
    entry &&
    sameTransport(entry, transport) &&
    (entry.settledAt === undefined || now() - entry.settledAt < VERDICT_REUSE_MS)
  ) {
    return entry.check
  }
  const answeredAt = input.answeredAt?.(id) ?? null
  const answerAge = answeredAt === null ? null : now() - answeredAt
  // Clock rollback must not extend the proof window.
  if (
    answeredAt !== null &&
    answerAge !== null &&
    answerAge >= 0 &&
    answerAge < LIVE_ANSWER_PROOF_MS
  ) {
    getManagedOCCdCrashLoopBrake().noteServing(id, answeredAt)
    return Promise.resolve({ state: 'serving' })
  }
  const next: ServingCheck = { ...transport, check: checkAndStart(input) }
  checks.set(id, next)
  void next.check.then(
    () => {
      next.settledAt = now()
    },
    () => {
      next.settledAt = -Infinity
    }
  )
  return next.check
}

/** An explicit Connect must not reuse a cached verdict from before it. */
export function forgetManagedOCCdServingVerdict(environmentId: string): void {
  checks.delete(environmentId)
}

export function resetManagedOCCdServingForTests(): void {
  checks.clear()
}

async function checkAndStart(input: OCCdManagedServingInput): Promise<OCCdManagedServing> {
  if (await input.probe(input.environment, PROBE_TIMEOUT_MS)) {
    getManagedOCCdCrashLoopBrake().noteServing(input.environment.id)
    return { state: 'serving' }
  }
  let starting = false
  // Braked hosts publish why they were not started.
  const braked = getManagedOCCdCrashLoopBrake().engaged(input.environment.id)
  const serving = await wakeIfStopped(input, () => {
    starting = true
    startListener?.starting(input.target)
  })
  if (starting || braked) {
    startListener?.settled(input.target, input.environment.id, serving)
  }
  return serving
}

async function wakeIfStopped(
  input: OCCdManagedServingInput,
  onStarting: () => void
): Promise<OCCdManagedServing> {
  const label = input.target.label
  try {
    const context = await resolveOCCdRemoteContext(input.target, input.connection)
    const wake = await wakeManagedOCCdUnlessCrashLooping(
      input.environment.id,
      label,
      managedOCCdSlot(context, input.remotePort),
      onStarting
    )
    if (wake.outcome === 'crash-loop') {
      return { state: 'unverifiable', detail: wake.detail }
    }
    if (wake.outcome === 'started') {
      const idle = wake.readiness.health?.previousIdleStop
      const cause = idle
        ? `it had stopped after idling at ${idle.stoppedAt}`
        : 'it had stopped without an idle-stop record (crash, signal or host restart)'
      console.info(`[ssh] Started the managed OCC server on ${label}; ${cause}.`)
      return { state: 'started', boundPort: occdBoundPort(wake.readiness) }
    }
    // A live unanswered process may still be starting; never restart it.
    if (wake.outcome === 'serving') {
      // A live PID alone does not prove the server answers.
      if (await input.probe(input.environment, PROBE_TIMEOUT_MS)) {
        getManagedOCCdCrashLoopBrake().noteServing(input.environment.id)
        return { state: 'serving' }
      }
      const detail = 'This host’s OCC server process is live but is not answering.'
      console.warn(`[ssh] The managed OCC server on ${label} is not answering: ${detail}`)
      return { state: 'unverifiable', detail }
    }
    const detail = wake.outcome === 'recovery-refused' ? wake.reason : wakeRefusal(wake.outcome)
    console.warn(`[ssh] The managed OCC server on ${label} is not answering: ${detail}`)
    return { state: 'unverifiable', detail }
  } catch (error) {
    console.warn(`[ssh] Could not start the managed OCC server on ${label}:`, error)
    return { state: 'unverifiable', detail: error instanceof Error ? error.message : String(error) }
  }
}

function wakeRefusal(outcome: 'not-activated' | 'unverifiable' | 'fenced'): string {
  switch (outcome) {
    case 'fenced':
      return MANAGED_OCCD_FENCED_DETAIL
    case 'not-activated':
      return MANAGED_OCCD_NOT_ACTIVATED_DETAIL
    case 'unverifiable':
      return 'Whether the server process is still running could not be proven, so it was not started.'
  }
}
