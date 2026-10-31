export const OCCD_PAIRING_REPAIR_FAILED_CODE = 'occd_pairing_repair_failed'

export class OCCdManagedPairingRepairFailedError extends Error {
  readonly code = OCCD_PAIRING_REPAIR_FAILED_CODE
  constructor(reason: string) {
    super(
      `${OCCD_PAIRING_REPAIR_FAILED_CODE}: the OCC server on this host no longer accepts this ` +
        `computer, and OCC couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
        `was stopped; its terminals can't be verified until OCC pairs again. Connect again to retry.`
    )
    this.name = 'OCCdManagedPairingRepairFailedError'
  }
}
