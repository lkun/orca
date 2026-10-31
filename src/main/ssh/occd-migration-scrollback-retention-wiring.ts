import type { Store } from '../persistence'
import {
  listOCCdMigrationSourceCutovers,
  setOCCdMigrationJournalChangeListener
} from './occd-migration-cutover-journal'

export function installOCCdMigrationScrollbackRetention(
  userDataPath: string,
  store: Pick<Store, 'syncOCCdMigrationScrollbackRetention'>
): void {
  const sync = (path: string): void => {
    try {
      // Retain bytes until durable commit/abort; closed tabs must still upload on retry.
      const pending = listOCCdMigrationSourceCutovers(path).filter(
        (cutover) => cutover.phase === 'source-fenced' || cutover.phase === 'destination-staged'
      )
      store.syncOCCdMigrationScrollbackRetention(pending.map((cutover) => cutover.manifest))
    } catch (error) {
      // An unreadable journal keeps whatever is held; releasing on a guess could lose bytes.
      console.warn('[occd-migration] Could not sync scrollback retention:', error)
    }
  }
  setOCCdMigrationJournalChangeListener(sync)
  sync(userDataPath)
}
