import type { ServeReadiness } from '../server/serve-readiness'
import type { OCCdManagedStopContext } from '../../shared/occd-stop-request'

export type OCCdOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Request a mobile-scoped pairing offer and terminal QR. */
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  /** Print only the ephemeral-VM recipe line. */
  recipeJson?: boolean
  projectRoot?: string
  bind?: string
  /** Slots have no browser client; occ serve supplies the installed app client. */
  webClientRoot?: string
}

export type OCCdHandle = {
  readiness: ServeReadiness
  managedStop: OCCdManagedStopContext
  stop(): Promise<void>
}
