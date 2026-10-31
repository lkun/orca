import type { OCCdManagedStopRequest } from '../../shared/occd-stop-request'
import { persistOCCdDaemonRetirementRecord } from './occd-completed-stop-receipt'
import type { OCCdDaemonRetirement } from './occd-daemon-retirement'
import { stopOCCdAutomationScheduler } from './occd-automations'
import { holdOCCdTerminalAdmissionUntilExit } from './occd-stop-terminal-admission'

// Keep daemon imports lazy so entry loading cannot initialize native code.
async function retireLazily(): Promise<OCCdDaemonRetirement> {
  const { retireOCCdDaemonIfIdle } = await import('./occd-daemon-retirement')
  return retireOCCdDaemonIfIdle()
}

/** Record managed-stop outcomes without vetoing the stop. */
export async function prepareOCCdManagedStop(
  request: OCCdManagedStopRequest,
  retire: () => Promise<OCCdDaemonRetirement> = retireLazily,
  stopAutomations: () => void = stopOCCdAutomationScheduler,
  holdTerminalAdmission: () => void = holdOCCdTerminalAdmissionUntilExit
): Promise<void> {
  // Fence spawns before potentially slow daemon retirement.
  holdTerminalAdmission()
  // Stop dispatch before census so new runs cannot race shutdown.
  stopAutomations()
  if (!request.retireIdleDaemon) {
    return
  }
  const outcome = await retire().catch((error: unknown): OCCdDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: `Retirement failed: ${error instanceof Error ? error.message : String(error)}`
  }))
  try {
    persistOCCdDaemonRetirementRecord(request, outcome)
  } catch (error) {
    // Missing retirement records remain unverifiable to the completion reader.
    console.error('[occd] could not record daemon retirement:', error)
  }
}
