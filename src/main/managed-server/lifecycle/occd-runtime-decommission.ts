// Keep claims, tunnels and registration until the host proves server exit.
import type {
  OCCdManagedCancelStopResult,
  OCCdManagedForgetResult,
  OCCdManagedStopResult
} from '../../../shared/occd-managed-runtime'
import type { OCCdDaemonRetirementVerdict } from '../../../shared/occd-stop-request'
import { removeManagedOCCdEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-occd-store'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findManagedSshTwin } from '../../../shared/remote-runtime/host-catalog/runtime-environment-host-key-match'
import type {
  KnownRuntimeEnvironment,
  OCCdSshDeploymentLink
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { recoverInterruptedOCCdActivation } from '../activation/occd-activation-recovery'
import { withStaleOCCdActivationRecoveryLock } from '../activation/occd-activation-lock'
import { readOCCdActivationTransaction } from '../activation/occd-activation-transaction-store'
import { reconcileOCCdDecommission } from './occd-decommission-recovery'
import { cancelRemoteOCCdManagedStop } from './occd-managed-remote-stop'
import {
  managedOCCdSlot,
  requireManagedOCCdInfrastructure,
  resolveLinkedOCCdContext
} from './occd-managed-runtime-context'
import { closeOCCdManagedTunnel, ensureOCCdManagedTunnel } from './occd-managed-tunnel'
import { clearManagedOCCdUpdateDeferral } from './occd-managed-update-deferrals'
import { removeOCCdMigrationJournalsForDestination } from '../../ssh/occd-migration-cutover-journal'
import { decommissionRemoteOCCd } from '../install/occd-remote-decommission'
import { withManagedOCCdLifecycle } from '../../ssh/occd-runtime-maintenance'
import { collectManagedTerminalCensus } from '../../ssh/occd-terminal-census-client'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'

type ManagedOCCdStopPolicy = {
  isActiveEnvironment: (environmentId: string) => boolean
  retireLocalState: (environmentId: string) => Promise<void> | void
  /** Runs inside the host's lifecycle, so a Connect queued behind the unlink still wins. */
  releaseHostTransport: (sshTargetId: string) => Promise<void>
}

type Refusal = Extract<OCCdManagedStopResult, { outcome: 'refused' }>
type Stopped = { version: string | null; retirement: OCCdDaemonRetirementVerdict | null }

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

export function stopManagedOCCdEnvironment(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal },
  policy: ManagedOCCdStopPolicy
): Promise<OCCdManagedStopResult> {
  return withManagedOCCdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'occd_stop_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before stopping it.'
      )
    }
    const stopped = await stopRemote(userDataPath, environment, deployment, args.signal)
    if ('outcome' in stopped) {
      return stopped
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId,
      stoppedVersion: stopped.version,
      retirement: stopped.retirement
    }
  })
}

/** Forget local state without assuming host exit; later connects may relink a still-running server. */
export function forgetManagedOCCdEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedOCCdStopPolicy
): Promise<OCCdManagedForgetResult> {
  return withManagedOCCdLifecycle(userDataPath, args.selector, (managed) =>
    forgetLinkedEnvironment(userDataPath, managed, policy)
  )
}

/** Forget one of two saved entries for one managed server; the other keeps managing it, so the host is not contacted. */
export function forgetRedundantManagedOCCdEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedOCCdStopPolicy
): Promise<OCCdManagedForgetResult> {
  return withManagedOCCdLifecycle(userDataPath, args.selector, (managed) => {
    // Checked in the queue and unlinked in the same tick, so two Removes cannot each count the other as the twin.
    if (!findManagedSshTwin(listEnvironments(userDataPath), managed.environment)) {
      return Promise.resolve(
        refuse(
          'live',
          'occd_forget_no_managed_twin',
          'No other saved entry manages this server anymore, so removing this one would leave it unmanaged. Stop it instead.'
        )
      )
    }
    return forgetLinkedEnvironment(userDataPath, managed, policy)
  })
}

async function forgetLinkedEnvironment(
  userDataPath: string,
  {
    environment,
    deployment
  }: { environment: KnownRuntimeEnvironment; deployment: OCCdSshDeploymentLink },
  policy: ManagedOCCdStopPolicy
): Promise<OCCdManagedForgetResult> {
  if (policy.isActiveEnvironment(environment.id)) {
    return refuse(
      'live',
      'occd_forget_active_environment',
      'This server is the default host for new projects. Choose another one under New projects open on before forgetting it.'
    )
  }
  await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
  return {
    outcome: 'forgotten',
    verdict: 'unverifiable',
    environmentId: environment.id,
    sshTargetId: deployment.sshTargetId
  }
}

async function stopRemote(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: OCCdSshDeploymentLink,
  signal?: AbortSignal,
  retried = false
): Promise<Stopped | Refusal> {
  const context = await resolveLinkedOCCdContext(environment, deployment, signal)
  const slot = managedOCCdSlot(context, deployment.remotePort, signal)
  const transaction = await readOCCdActivationTransaction(slot)
  if (transaction?.operation === 'decommission') {
    // Resume the exact interrupted stop from its journal.
    const recovered = await recoverInterruptedOCCdActivation(slot)
    if (recovered.outcome === 'recovered' && recovered.activeVersion === null) {
      return { version: transaction.activeVersion, retirement: null }
    }
    if (recovered.outcome === 'refused') {
      return refuse(recovered.verdict, recovered.code, recovered.reason)
    }
    if (recovered.outcome === 'pending') {
      return refuse('unverifiable', recovered.code, recovered.reason)
    }
    // Another run may settle recovery first; restart from its resulting record.
    if (recovered.outcome === 'none') {
      return retried
        ? refuse(
            'unverifiable',
            'occd_stop_journal_changed',
            'Another run on this server changed its stop while this one waited. Refresh and retry.'
          )
        : stopRemote(userDataPath, environment, deployment, signal, true)
    }
    return refuse(
      'live',
      'occd_stop_withdrawn',
      'The interrupted stop was withdrawn and the server keeps serving. Stop it again.'
    )
  }
  if (transaction) {
    return refuse(
      'unverifiable',
      'occd_activation_recovery_required',
      'An earlier update on this server was interrupted. Recover it before stopping.'
    )
  }
  const record = context.activationRecord
  if (!record.active) {
    return { version: null, retirement: null }
  }
  const census = await collectManagedTerminalCensus(userDataPath, environment, record)
  const result = await decommissionRemoteOCCd({ ...slot, record, census })
  if (result.outcome === 'refused') {
    return refuse(result.verdict, result.code, result.reason)
  }
  return { version: result.version, retirement: result.retirement }
}

async function unlinkEnvironmentLocally(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: OCCdSshDeploymentLink,
  policy: ManagedOCCdStopPolicy
): Promise<void> {
  // Remove registration before releasing claims so crashes leave a resumable hidden target.
  removeManagedOCCdEnvironment(userDataPath, environment.id)
  await policy.retireLocalState(environment.id)
  await closeOCCdManagedTunnel(environment.id)
  const { claims } = requireManagedOCCdInfrastructure()
  claims.releaseForUserRemoval(deployment.sshTargetId, environment.id)
  clearManagedOCCdUpdateDeferral(environment.id)
  await claims.flush()
  // Clear journals after the fence; stale leftovers are recoverable on later conversion.
  removeOCCdMigrationJournalsForDestination(userDataPath, deployment.sshTargetId, environment.id)
  // No server serves the host now, and an unserved host never stays connected.
  await policy.releaseHostTransport(deployment.sshTargetId)
}

export function cancelManagedOCCdStop(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal }
): Promise<OCCdManagedCancelStopResult> {
  return withManagedOCCdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    const context = await resolveLinkedOCCdContext(environment, deployment, args.signal)
    const slot = managedOCCdSlot(context, deployment.remotePort, args.signal)
    let result: OCCdManagedCancelStopResult
    try {
      result = await withStaleOCCdActivationRecoveryLock(slot, async (lock) => {
        const transaction = await readOCCdActivationTransaction(slot)
        if (transaction?.operation !== 'decommission') {
          if (transaction) {
            lock.retain()
          }
          return { outcome: 'none' }
        }
        if (transaction.phase === 'process-exited') {
          lock.retain()
          return { outcome: 'already-stopped' }
        }
        if (transaction.request) {
          const cancellation = await cancelRemoteOCCdManagedStop(slot, transaction.request)
          if (cancellation.outcome !== 'canceled') {
            lock.retain()
            return {
              outcome: 'refused',
              verdict: 'live',
              code: 'occd_stop_already_dispatched',
              reason: 'occd already acted on the stop and is shutting down; it cannot be canceled.'
            }
          }
        }
        const kept = await reconcileOCCdDecommission(slot, {
          action: 'keep-serving',
          version: transaction.activeVersion
        })
        if (kept.outcome !== 'recovered' || !kept.activeVersion) {
          lock.retain()
          return {
            outcome: 'refused',
            verdict: 'unverifiable',
            code: 'occd_stop_cancel_unverifiable',
            reason: 'The stop was withdrawn but the server could not be shown to be serving.'
          }
        }
        return { outcome: 'canceled', activeVersion: kept.activeVersion }
      })
    } catch (error) {
      if (error instanceof RemoteInstallLockBusyError) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'occd_stop_still_running',
          reason: 'A stop on this server may still be running. Retry after it settles.'
        }
      }
      throw error
    }
    if (result.outcome === 'canceled') {
      await ensureOCCdManagedTunnel(userDataPath, environment.id)
    }
    return result
  })
}
