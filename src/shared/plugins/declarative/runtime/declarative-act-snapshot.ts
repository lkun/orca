import { PLUGIN_DECLARATIVE_MESSAGES } from '../plugin-declarative-message-names'
import { captureAtomValues } from './declarative-atoms'
import { readHostMessage } from './declarative-host-messages'
import type { OCCBridge, OCCDisposable } from './declarative-runtime-types'

/**
 * `occ plugin shot --act` changes the live panel; OCC asks this guest to remember its atoms
 * before acting (`ui.snapshot`) and to put them back after the capture (`ui.restore`). Only this
 * guest's atoms: what handlers did elsewhere (worker requests, storage writes) stays.
 */
export function actSnapshotSubscriptions(
  on: NonNullable<OCCBridge['on']>,
  document: string
): OCCDisposable[] {
  let restore: (() => void) | null = null
  const ours = (payload: unknown): boolean => readHostMessage(payload).document === document
  return [
    on(PLUGIN_DECLARATIVE_MESSAGES.snapshot, (payload) => {
      if (ours(payload)) {
        restore = captureAtomValues()
      }
    }),
    on(PLUGIN_DECLARATIVE_MESSAGES.restore, (payload) => {
      if (ours(payload) && restore) {
        const pending = restore
        restore = null
        pending()
      }
    })
  ]
}
