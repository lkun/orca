import type { OCCPushPayload } from './push-payload'

export type NativeDismissal = {
  rememberAll(payloads: readonly OCCPushPayload[]): Promise<void>
  wasDismissed(payload: OCCPushPayload): Promise<boolean>
}
// Android and web use JavaScript storage; iOS requires the native ledger.
export const nativePushDismissal: NativeDismissal | null = null
