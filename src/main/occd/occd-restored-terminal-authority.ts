import { OCC_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import type { OCCRuntimeService } from '../runtime/occ-runtime'
import type { OCCdFeatureReadiness } from '../runtime/rpc/occd-feature-readiness'
import { placeUnshownLiveTerminalsBestEffort } from '../runtime/terminal/adoption/unshown-live-terminal-placement'
import type { createOCCdStartupTiming } from './occd-startup-timing'

/** Restored orchestration authority, the legacy terminal reconcile and unshown placement, in order. */
export async function restoreOCCdTerminalAuthority(
  runtime: OCCRuntimeService,
  timed: ReturnType<typeof createOCCdStartupTiming>['time'],
  readiness: OCCdFeatureReadiness
): Promise<void> {
  await timed('orchestration', () => runtime.refreshRestoredOrchestrationAuthority())
  readiness.open('orchestration')
  // Terminal inventory stays on the critical path: no latch, every client needs it at connect.
  await timed('reconcile-terminals', () => runtime.reconcileLegacyWorkerTerminals())
  if (OCC_LAYOUT_OWNER_IS_MAIN) {
    await placeUnshownLiveTerminalsBestEffort(runtime)
  }
  readiness.open('unshownPlacement')
}
