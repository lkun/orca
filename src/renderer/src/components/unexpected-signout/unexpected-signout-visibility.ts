import type { OCCProfileAuthStatus } from '../../../../shared/occ-profiles'

export type UnexpectedSignoutGate = {
  authStatus: OCCProfileAuthStatus | null
  persistedUIReady: boolean
  appVersion: string | null
  dismissedVersion: string | null
}

export function shouldShowUnexpectedSignoutCard(gate: UnexpectedSignoutGate): boolean {
  if (!gate.persistedUIReady || gate.appVersion === null) {
    return false
  }
  if (gate.dismissedVersion !== null) {
    return false
  }
  return (
    gate.authStatus?.configured === true &&
    gate.authStatus.state === 'reconnect-required' &&
    gate.authStatus.cloud != null
  )
}
