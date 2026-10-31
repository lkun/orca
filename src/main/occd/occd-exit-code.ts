import { OCCdBindAddressError } from './occd-bind-address'
import { OCCdBundledRuntimeError } from './occd-bundled-runtime'
import { OCCdInstanceLockError } from './occd-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access'
import { OCCD_EXIT_CONFIGURATION } from './occd-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'

export const OCCD_EXIT_FAILED = 1

export function resolveOCCdExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof OCCdInstanceLockError &&
    error.code === 'occd_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  return error instanceof OCCdInstanceLockError ||
    error instanceof OCCdBindAddressError ||
    error instanceof OCCdBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? OCCD_EXIT_CONFIGURATION
    : OCCD_EXIT_FAILED
}
