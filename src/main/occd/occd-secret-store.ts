// Always report available to prevent plaintext fallback; throw on seal/unseal when the key is unavailable.
import type { SecretStore } from '../../shared/secret-store'
import { sweepStaleRecordStaging } from './occd-secret-key-record'
import {
  occdSecretStatePath,
  resolveState,
  type OCCdSecretStorePrepareOptions,
  type StoreState
} from './occd-secret-key-resolution'
import { openOCCdSecret, sealOCCdSecret } from './occd-secret-sealing'

export type OCCdSecretStore = SecretStore & {
  prepare(options: OCCdSecretStorePrepareOptions): Promise<boolean>
}

export function createOCCdSecretStore(
  log: (message: string) => void = (message) => console.warn(message)
): OCCdSecretStore {
  let state: StoreState = { kind: 'pending' }
  const readyKey = (): Buffer => {
    if (state.kind === 'ready') {
      return state.key
    }
    throw new Error(
      state.kind === 'unavailable'
        ? state.message
        : 'occd_secret_store_not_prepared — the headless secret store has not loaded its key yet'
    )
  }
  return {
    isEncryptionAvailable: () => state.kind !== 'plaintext',
    encryptString: (plainText) => sealOCCdSecret(readyKey(), plainText),
    decryptString: (cipher) => openOCCdSecret(readyKey(), cipher),
    describeProtectionGap: () => {
      switch (state.kind) {
        case 'ready':
          return state.gap
        case 'unavailable':
          return state.message
        case 'plaintext':
          return state.reason
        case 'pending':
          return "OCC's headless server has not loaded its credential key yet."
      }
    },
    async prepare(next) {
      sweepStaleRecordStaging(occdSecretStatePath(next))
      state = await resolveState(next, log)
      return state.kind === 'ready'
    }
  }
}
