import { join } from 'node:path'
import { prepareOCCdSecretStore } from './occd-host-adapters'

export async function prepareOCCdSecretStoreAndMigrate(userDataPath: string): Promise<void> {
  const { getSecretStore } = await import('../../shared/secret-store')
  const { reportSecretProtectionGap } = await import('../host/secret-protection-report')
  const { migratePlaintextCredentials, occdCredentialRoot } =
    await import('./occd-plaintext-credential-migration')
  // Keep sealing keys outside disposable OCC_USER_DATA roots.
  if (await prepareOCCdSecretStore(occdCredentialRoot(), userDataPath)) {
    migratePlaintextCredentials(getSecretStore())
  }
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'occ-data.json') })
}
