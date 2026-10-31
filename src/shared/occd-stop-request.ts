/** Stop files reach only the watching occd; signals from stale PID records could stop an unrelated reused process. */
import { z } from 'zod'
import { openEnum } from './zod-salvage'

/** Plain request in the slot directory: the same graceful stop as SIGTERM. */
export const OCCD_STOP_REQUEST_FILENAME = '.occd-stop-request'
/** Prefix of an instance-bound request in the data root; older listeners never match it. */
export const OCCD_MANAGED_STOP_REQUEST_PREFIX = '.occd-managed-stop-request'
export const OCCD_MANAGED_STOP_REQUEST_MAX_BYTES = 32 * 1024
export const OCCD_STOP_RECEIPTS_DIRNAME = 'occd-stop-receipts'
export const OCCD_COMPLETE_MANAGED_STOP_FLAG = '--complete-managed-stop'
/** Names a staged request file instead of inline JSON; Windows hosts never put the JSON on argv. */
export const OCCD_MANAGED_STOP_REQUEST_FILE_FLAG = '--request-file'

/** One occd process: its PID, start time, and the instance lock record it published. */
export const OCCdManagedStopInstanceSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Linux only, copied from the lock; older clients omit it and older slots drop it. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  nonce: z.string().min(1).max(255),
  lockPath: z.string().min(1).max(4096)
})

// Older slots drop newer optional request fields rather than refuse the stop.
export const OCCdManagedStopRequestSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.uuid(),
  version: z.string().min(1).max(255),
  runtimeId: z.string().min(1).max(255),
  instance: OCCdManagedStopInstanceSchema,
  /** Best effort: also retire the terminal daemon if it is provably idle. Never blocks the stop. */
  retireIdleDaemon: z.literal(true).optional()
})

export type OCCdManagedStopInstance = z.infer<typeof OCCdManagedStopInstanceSchema>
export type OCCdManagedStopRequest = z.infer<typeof OCCdManagedStopRequestSchema>

/** Equality key for a request; omits the incarnation, which an older client recovering it drops. */
export function occdManagedStopRequestKey(request: OCCdManagedStopRequest): string {
  const { instance, ...rest } = OCCdManagedStopRequestSchema.parse(request)
  const { linuxStartTicks: _ticks, bootId: _bootId, ...bound } = instance
  return JSON.stringify({ ...rest, instance: bound })
}
/** What a stopping occd must match before a managed request may stop it. */
export type OCCdManagedStopContext = Omit<
  OCCdManagedStopRequest,
  'schemaVersion' | 'transactionId'
>

const STOP_VERDICTS = ['live', 'unverifiable', 'exited'] as const
const RETIREMENT_VERDICTS = ['retired', 'live', 'unverifiable'] as const

/** The execution host's verdict; `exited` only on proof, never on silence. */
export const OCCdManagedStopVerdictSchema = z.enum(STOP_VERDICTS)

/** `retired` only when the daemon accepted; a busy daemon stays up and keeps its terminals. */
export const OCCdDaemonRetirementVerdictSchema = z.enum(RETIREMENT_VERDICTS)

// Read by clients older than the slot that printed them: unknown fields and arms degrade.
const stopReplyRequestFields = OCCdManagedStopRequestSchema.shape

export const OCCdManagedStopCompletionSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('occd_managed_stop_completion'),
  verdict: openEnum(STOP_VERDICTS, 'unverifiable'),
  receiptPersisted: z.boolean(),
  /** For a request that asked to retire the daemon, the outcome its receipt recorded. */
  retirement: openEnum(RETIREMENT_VERDICTS, 'unverifiable').optional()
})

/** What the stopping occd observed about its daemon, written before it exits. */
export const OCCdDaemonRetirementRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('occd_managed_stop_retirement'),
  request: OCCdManagedStopRequestSchema,
  retirement: OCCdDaemonRetirementVerdictSchema,
  liveSessions: z.number().int().nonnegative().nullable(),
  reason: z.string().max(4096).nullable()
})

export const OCCdCompletedStopReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('occd_managed_stop_completed'),
  request: OCCdManagedStopRequestSchema,
  exitedAt: z.iso.datetime({ offset: true }),
  /** Present only when the request asked to retire the daemon. */
  retirement: OCCdDaemonRetirementVerdictSchema.optional()
})

export type OCCdManagedStopVerdict = z.infer<typeof OCCdManagedStopVerdictSchema>
export type OCCdManagedStopCompletion = z.infer<typeof OCCdManagedStopCompletionSchema>
export type OCCdCompletedStopReceipt = z.infer<typeof OCCdCompletedStopReceiptSchema>
export type OCCdDaemonRetirementVerdict = z.infer<typeof OCCdDaemonRetirementVerdictSchema>
export type OCCdDaemonRetirementRecord = z.infer<typeof OCCdDaemonRetirementRecordSchema>

export const OCCD_CANCEL_MANAGED_STOP_FLAG = '--cancel-managed-stop'
/** Readiness `health.stopRequests`: this build consumes stop files and both commands above. */
export const OCCD_STOP_REQUESTS_CAPABILITY = 1

/** Exclusive per-transaction creation ensures only occd dispatch or client cancellation can win. */
export const OCCdManagedStopDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('occd_managed_stop_decision'),
  request: OCCdManagedStopRequestSchema,
  decision: z.enum(['dispatched', 'canceled'])
})

/** `dispatched` means occd already acted on the request; the caller must await its exit. */
export const OCCdManagedStopCancellationSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('occd_managed_stop_cancellation'),
  // Unknown degrades to `dispatched`: the caller then awaits exit rather than assume a cancel.
  outcome: openEnum(['canceled', 'dispatched'], 'dispatched')
})

export type OCCdManagedStopDecision = z.infer<typeof OCCdManagedStopDecisionSchema>
export type OCCdManagedStopCancellation = z.infer<typeof OCCdManagedStopCancellationSchema>
