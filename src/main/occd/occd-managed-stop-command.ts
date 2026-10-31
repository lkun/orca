// Exit 0 means JSON was printed; read its outcome. Exit 64 is invalid input, 1 is failure without exit proof.
import {
  OCCD_CANCEL_MANAGED_STOP_FLAG,
  OCCD_COMPLETE_MANAGED_STOP_FLAG,
  OCCD_MANAGED_STOP_REQUEST_FILE_FLAG,
  OCCdManagedStopRequestSchema,
  type OCCdManagedStopCancellation,
  type OCCdManagedStopCompletion,
  type OCCdManagedStopRequest
} from '../../shared/occd-stop-request'
import { cancelOCCdManagedStop } from './occd-managed-stop-cancellation'
import { readOCCdCompletedStopReceipt } from './occd-completed-stop-receipt'
import { readOCCdManagedStopRequest } from './occd-managed-stop-request'
import { ZodError } from 'zod'
import {
  completeOCCdManagedStop,
  type OCCdManagedStopCompletionOptions
} from './occd-managed-stop-completion'

export async function runOCCdManagedStopCommand(
  argv: readonly string[],
  options: OCCdManagedStopCompletionOptions = {}
): Promise<OCCdManagedStopCompletion> {
  const request = parseRequestArgument(argv, OCCD_COMPLETE_MANAGED_STOP_FLAG)
  const verdict = await completeOCCdManagedStop(request, options)
  const retirement =
    verdict === 'exited' && request.retireIdleDaemon
      ? readOCCdCompletedStopReceipt(request)?.retirement
      : undefined
  const completion: OCCdManagedStopCompletion = {
    ...request,
    kind: 'occd_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited',
    ...(retirement ? { retirement } : {})
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export function runOCCdManagedStopCancelCommand(
  argv: readonly string[]
): OCCdManagedStopCancellation {
  const request = parseRequestArgument(argv, OCCD_CANCEL_MANAGED_STOP_FLAG)
  const cancellation: OCCdManagedStopCancellation = {
    ...request,
    kind: 'occd_managed_stop_cancellation',
    outcome: cancelOCCdManagedStop(request)
  }
  process.stdout.write(`${JSON.stringify(cancellation)}\n`)
  return cancellation
}

function parseRequestArgument(argv: readonly string[], flag: string): OCCdManagedStopRequest {
  if (argv[0] !== flag) {
    throw new Error('occd_managed_stop_invalid_arguments')
  }
  if (argv[1] === OCCD_MANAGED_STOP_REQUEST_FILE_FLAG) {
    if (argv.length !== 3 || !argv[2]) {
      throw new Error('occd_managed_stop_invalid_arguments')
    }
    return readOCCdManagedStopRequest(argv[2])
  }
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('occd_managed_stop_invalid_arguments')
  }
  return OCCdManagedStopRequestSchema.parse(JSON.parse(argv[1]))
}

export const OCCD_MANAGED_STOP_EXIT_VERDICT = 0
export const OCCD_MANAGED_STOP_EXIT_FAILED = 1
export const OCCD_MANAGED_STOP_EXIT_USAGE = 64

export async function runOCCdManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = OCCD_MANAGED_STOP_EXIT_VERDICT
  try {
    if (argv[0] === OCCD_CANCEL_MANAGED_STOP_FLAG) {
      runOCCdManagedStopCancelCommand(argv)
    } else {
      await runOCCdManagedStopCommand(argv)
    }
  } catch (error) {
    console.error('occd: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'occd_managed_stop_invalid_arguments')
        ? OCCD_MANAGED_STOP_EXIT_USAGE
        : OCCD_MANAGED_STOP_EXIT_FAILED
  }
  // Drain stdout before exit: callers read the result to EOF.
  process.stdout.write('', () => process.exit(code))
}
