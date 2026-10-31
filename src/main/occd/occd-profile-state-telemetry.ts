import type { ProfileStateStorageClassification } from '../persistence/profile-state/profile-state-storage-classification'

/** Exclude paths, profile IDs and serialized state from fleet telemetry. */
export type OCCdProfileStateAuthoritySelection = {
  backend: 'sqlite'
  classification: ProfileStateStorageClassification
  authority_mode: 'sqlite-established'
  runtime: 'occd'
  migrated: boolean
}

type OCCdProfileStateTelemetrySink = (line: string) => void

export function formatOCCdProfileStateAuthoritySelected(
  selection: OCCdProfileStateAuthoritySelection
): string {
  // Select fields explicitly so structural typing cannot leak extra runtime data.
  return `[occd-telemetry] ${JSON.stringify({
    event: 'profile_state_authority_selected',
    backend: selection.backend,
    classification: selection.classification,
    authority_mode: selection.authority_mode,
    runtime: selection.runtime,
    migrated: selection.migrated
  })}`
}

/** Use stderr without desktop dependencies; telemetry failures must not block serving. */
export function emitOCCdProfileStateAuthoritySelected(
  selection: OCCdProfileStateAuthoritySelection,
  sink: OCCdProfileStateTelemetrySink = (line) => console.error(line)
): void {
  try {
    sink(formatOCCdProfileStateAuthoritySelected(selection))
  } catch {}
}
