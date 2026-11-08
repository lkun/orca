import type { SshTarget } from '../../shared/ssh-types'
import type { WslOCCdHostTarget } from '../wsl/occd/wsl-occd-host-target'
import type { RemoteInstallTransport } from '../managed-server/install/remote-install-transport'
import type { OCCdLaunchDetach } from '../managed-server/install/occd-remote-launch'

/** Only id/label have the same meaning across host kinds. */
export type OCCdHostTarget = SshTarget | WslOCCdHostTarget

export function isWslOCCdHostTarget(target: OCCdHostTarget): target is WslOCCdHostTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export type OCCdHostTransport = RemoteInstallTransport & {
  getTarget(): OCCdHostTarget
  /** Absent on SSH, which detaches with nohup. */
  readonly occdLaunchDetach?: OCCdLaunchDetach
  /** Pass client-only host facts at launch; SSH adds none. */
  readonly occdLaunchEnv?: (
    launch: OCCdLaunchEnvRequest
  ) => Promise<readonly OCCdLaunchEnvEntry[]>
}

/** The slot being launched; entries only its own build understands must check the version. */
export type OCCdLaunchEnvRequest = { readonly fullVersion: string }

/** `keep-existing` applies the value only when the launching shell has none, so a user's own setting wins. */
export type OCCdLaunchEnvEntry = readonly [name: string, value: string, mode?: 'keep-existing']
