import type { Store } from '../persistence/loading-store/store'
import type { OCCRuntimeService } from '../runtime/occ-runtime'
import { registerSshHandlers } from '../ipc/ssh/ssh'
import { mainProcessState as state } from './main-process-state'

/** Register SSH before any window so headless serve can list/connect targets (#25886, #8489); later window registration is idempotent. */
export function registerHeadlessServeSshHandlers(store: Store, runtime: OCCRuntimeService): void {
  registerSshHandlers(store, () => state.mainWindow ?? null, runtime)
}
