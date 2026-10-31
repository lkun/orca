import { occSessionAddressSql } from '../occ-session-address-sql'
import type { OCCSessionId } from '../../../../../shared/occ-session-address'
import type { RunRow } from '../../types'

type RunCoordinatorOCCSessionFields = Pick<
  RunRow,
  'coordinator_occ_session_id' | 'coordinator_occ_session_id_generation' | 'consumer_generation'
>

/** Count a coordinator session id only at its stamped consumer generation; older writers bump generation without clearing it. */
export function currentRunCoordinatorOCCSessionId(
  run: RunCoordinatorOCCSessionFields
): OCCSessionId | null {
  return run.coordinator_occ_session_id_generation === run.consumer_generation
    ? run.coordinator_occ_session_id
    : null
}

/** The same rule in SQL, for a `runs` row named `row` (a table name, alias, or `NEW`). */
export function currentRunCoordinatorOCCSessionIdSql(row: string): string {
  return `(CASE WHEN ${row}.coordinator_occ_session_id_generation = ${row}.consumer_generation
    THEN ${row}.coordinator_occ_session_id END)`
}

/** The coordinator's `occ_session_id:<id>` address in SQL; NULL when it has no current OCC session id. */
export function currentRunCoordinatorSessionAddressSql(row: string): string {
  return occSessionAddressSql(currentRunCoordinatorOCCSessionIdSql(row))
}
