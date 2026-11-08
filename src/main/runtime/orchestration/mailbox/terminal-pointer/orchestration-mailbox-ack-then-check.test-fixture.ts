import type { OCCRuntimeService } from '../../../occ-runtime'
import {
  checkBoundMailbox,
  type MailboxCheckOptions
} from './orchestration-mailbox-check.test-fixture'

/** Acknowledge a held Delivery, then take the next batch with a plain check, as agents do. */
export async function ackThenCheck(
  runtime: OCCRuntimeService,
  deliveryId: string,
  options: MailboxCheckOptions = {}
) {
  await checkBoundMailbox(runtime, { ...options, ack: deliveryId })
  return checkBoundMailbox(runtime, options)
}
