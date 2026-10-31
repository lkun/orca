import { cleanCloudServiceOrigin } from '../../shared/cloud-service-url'

export function resolveConnectorOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string {
  return (
    cleanCloudServiceOrigin(env.OCC_CONNECTOR_URL, !packaged) ?? 'https://connector.onocc.dev'
  )
}
