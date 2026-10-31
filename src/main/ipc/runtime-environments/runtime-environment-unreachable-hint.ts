import { withRemoteRuntimeTailscaleHint } from '../../../shared/remote-runtime/remote-runtime-tailscale-hint'
import { classifyRuntimeEnvironmentHost } from '../../../shared/runtime-environment-host-kind'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'

const UNREACHABLE_RE =
  /could not connect to the remote occ runtime|remote occ runtime closed the connection|timed out (?:waiting for|while connecting to) the remote occ runtime/i

export function withRuntimeUnreachableHint(
  environment: Pick<KnownRuntimeEnvironment, 'occdDeployment'>,
  message: string,
  endpoint: string | null | undefined
): string {
  const host = classifyRuntimeEnvironmentHost(environment)
  switch (host.kind) {
    case 'network':
      return withRemoteRuntimeTailscaleHint(message, endpoint)
    case 'wsl':
      // WSL is reached locally through wsl.exe; a Tailscale hint cannot help.
      return UNREACHABLE_RE.test(message)
        ? `${message} The OCC server in the WSL distro ${host.deployment.distro} isn’t answering; connect it again in Settings → Remote OCC Servers → WSL hosts.`
        : message
  }
}
