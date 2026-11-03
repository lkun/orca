import { OCCD_IDLE_TIMEOUT_ENV } from './occd-idle-exit'
import { OCCD_MANAGED_ACTIVATION_ROOT_ENV } from './occd-managed-launch-env'

/** WSL-host launch marker; SSH guests and WSLg retain their original PATH. */
export const OCCD_WSL_HOST_ENV = 'OCC_WSL_OCCD_HOST'

/** Desktop-provided registry ID; guests cannot read it themselves. */
export const OCCD_WSL_DISTRO_GUID_ENV = 'OCC_WSL_DISTRO_GUID'

/**
 * What a client puts in a server's launch env. A user's own `occd` started from one of the
 * server's shells is not that server, so every pane scrubs these.
 */
export const OCCD_SERVER_LAUNCH_ENV_KEYS = [
  // Not client-managed.
  OCCD_MANAGED_ACTIVATION_ROOT_ENV,
  // Keeps the default idle window.
  OCCD_IDLE_TIMEOUT_ENV,
  // Not a WSL host: no migration capabilities, no /mnt/c refusal, no account-push wait.
  OCCD_WSL_HOST_ENV,
  OCCD_WSL_DISTRO_GUID_ENV
] as const
