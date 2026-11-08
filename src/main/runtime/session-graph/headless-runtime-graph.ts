import { HEADLESS_RUNTIME_WINDOW_ID } from '../../../shared/runtime-session-contracts'
import type { OCCRuntimeService } from '../occ-runtime'

/** Publish readiness without a renderer so status and session-tab inventory do not wait forever. */
export function publishHeadlessRuntimeGraph(
  runtime: Pick<OCCRuntimeService, 'syncWindowGraph'>
): void {
  runtime.syncWindowGraph(
    HEADLESS_RUNTIME_WINDOW_ID,
    { tabs: [], leaves: [] },
    { includeAgentSenders: false }
  )
}
