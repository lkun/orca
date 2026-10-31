import { OCCD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/occd-managed-launch-env'

type OCCdWsPortOptions = {
  wsPort?: number
  preferPinnedWsPort?: boolean
  requirePinnedWsPort?: boolean
}

/** Honor explicit ports; managed launches permit fallback because WSL distros share loopback. */
export function occdWsPortOptions(
  port: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): OCCdWsPortOptions {
  if (port === undefined) {
    return {}
  }
  const managed = Boolean(env[OCCD_MANAGED_ACTIVATION_ROOT_ENV])
  return {
    wsPort: port,
    preferPinnedWsPort: true,
    ...(managed ? {} : { requirePinnedWsPort: true })
  }
}
