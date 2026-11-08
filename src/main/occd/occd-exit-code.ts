import { OCCdBindAddressError } from '../../shared/occd-bind-address'
import { OCCdBundledRuntimeError } from './occd-bundled-runtime'
import { OCCdInstanceLockError } from './occd-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access-error'
import { OCCD_EXIT_CONFIGURATION } from './occd-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'
import { OCCD_EXIT_TERMINALS_NOT_DURABLE } from '../../shared/serve-supervised-terminal-durability'
import { OCCdTerminalsNotDurableError } from './occd-serve-supervision'

export const OCCD_EXIT_FAILED = 1

export function resolveOCCdExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof OCCdInstanceLockError &&
    error.code === 'occd_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  if (error instanceof OCCdTerminalsNotDurableError) {
    return OCCD_EXIT_TERMINALS_NOT_DURABLE
  }
  return error instanceof OCCdInstanceLockError ||
    error instanceof OCCdBindAddressError ||
    error instanceof OCCdBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? OCCD_EXIT_CONFIGURATION
    : OCCD_EXIT_FAILED
}
