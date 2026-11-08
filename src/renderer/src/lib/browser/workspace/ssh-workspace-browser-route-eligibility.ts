import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId
} from '../../../../../shared/execution-host'
import {
  getOCCdSshDeployment,
  type PublicKnownRuntimeEnvironment
} from '../../../../../shared/remote-runtime/host-catalog/runtime-environments'

type SshBrowserRoutingSettings = Pick<
  GlobalSettings,
  'browserSshWorkspaceRoutingEnabled' | 'browserSshWorkspaceRoutingDisabledTargetIds'
>

export type SshWorkspaceBrowserRouteEligibility = {
  targetId: string
  eligible: boolean
  expectedSshTargetGeneration?: number
}

export function resolveSshWorkspaceBrowserRouteEligibility(
  executionHostId: string | null | undefined,
  settings: SshBrowserRoutingSettings | null | undefined,
  environments?: readonly Pick<PublicKnownRuntimeEnvironment, 'id' | 'occdDeployment'>[]
): SshWorkspaceBrowserRouteEligibility | null {
  const parsed = parseExecutionHostId(executionHostId)
  const environment =
    parsed?.kind === 'runtime'
      ? environments?.find((candidate) => candidate.id === parsed.environmentId)
      : undefined
  // WSL pages use the paired-runtime tunnel over wsl.exe, never SSH/localhost-forwarded routing.
  const deployment = environment && getOCCdSshDeployment(environment)
  const targetId = parsed?.kind === 'ssh' ? parsed.targetId : deployment?.sshTargetId
  // Why: a recipe VM's target is never a direct workspace host, but routes pages as its deployment's.
  if (!targetId || (parsed?.kind === 'ssh' && isRuntimeOwnedSshTargetId(targetId))) {
    return null
  }
  return {
    targetId,
    ...(deployment ? { expectedSshTargetGeneration: deployment.sshTargetGeneration } : {}),
    eligible:
      settings?.browserSshWorkspaceRoutingEnabled !== false &&
      !settings?.browserSshWorkspaceRoutingDisabledTargetIds?.includes(targetId)
  }
}
