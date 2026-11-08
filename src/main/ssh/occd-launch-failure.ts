import { OCCdWindowsLaunchFailedError } from '../managed-server/install/occd-remote-launch-windows'
import { OCCdLaunchReadinessError } from './occd-active-readiness'

/** A launch that ended a run: it never became ready, or the host reported it could not start. */
export function isOCCdLaunchFailure(error: unknown): error is Error {
  return (
    error instanceof OCCdLaunchReadinessError || error instanceof OCCdWindowsLaunchFailedError
  )
}

/** Only a readiness failure had a running occd, whose death the next occd will report. */
export function occdLaunchFailureRanProcess(error: Error): boolean {
  return error instanceof OCCdLaunchReadinessError
}
