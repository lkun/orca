/** Desktop main publishes managed-server actions for runtime RPC; headless hosts without a registry advertise none. */
import type {
  OCCdManagedPastLiveTerminals,
  OCCdManagedCancelStopResult,
  OCCdManagedDeployResult,
  OCCdManagedForgetResult,
  OCCdManagedRecoveryResult,
  OCCdManagedRollbackResult,
  OCCdManagedRuntimeStatus,
  OCCdManagedStopResult
} from '../../shared/occd-managed-runtime'

export type ManagedServerActions = {
  status: (selector: string) => Promise<OCCdManagedRuntimeStatus>
  update: (
    selector: string,
    force: boolean,
    pastLiveTerminals?: OCCdManagedPastLiveTerminals
  ) => Promise<OCCdManagedDeployResult>
  rollback: (selector: string) => Promise<OCCdManagedRollbackResult>
  /** `acceptChangedState` restores the snapshot over state a rejected build changed. */
  recover: (selector: string, acceptChangedState?: boolean) => Promise<OCCdManagedRecoveryResult>
  stop: (selector: string) => Promise<OCCdManagedStopResult>
  cancelStop: (selector: string) => Promise<OCCdManagedCancelStopResult>
  forget: (selector: string) => Promise<OCCdManagedForgetResult>
}

let registered: ManagedServerActions | null = null

export function registerManagedServerActions(actions: ManagedServerActions | null): void {
  registered = actions
}

export function getManagedServerActions(): ManagedServerActions | null {
  return registered
}
