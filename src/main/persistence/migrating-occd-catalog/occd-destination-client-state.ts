import type { PersistedState } from '../../../shared/persisted-state-types'
import type {
  OCCdMigrationClientStatePayload,
  OCCdMigrationUiRoutingState
} from '../../../shared/occd-migration/occd-migration-client-state'
import { serializeOCCdMigrationValue } from '../../../shared/occd-migration/occd-migration-manifest'

export type PreparedOCCdMigrationClientState = {
  incoming: OCCdMigrationClientStatePayload | undefined
  mobileSelections: NonNullable<
    OCCdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']
  >
  uiRouting: OCCdMigrationUiRoutingState | undefined
}

export function prepareOCCdMigrationClientState(
  incoming: OCCdMigrationClientStatePayload | undefined,
  state: PersistedState
): PreparedOCCdMigrationClientState {
  const mobileSelections = prepareMobileSelections(
    incoming?.mobileClientTabSelectionsByDeviceId,
    state
  )
  const uiRouting = incoming?.uiRouting ? structuredClone(incoming.uiRouting) : undefined
  return {
    incoming,
    mobileSelections,
    uiRouting
  }
}

export function applyPreparedOCCdMigrationClientState(
  prepared: PreparedOCCdMigrationClientState,
  state: PersistedState
): void {
  if (Object.keys(prepared.mobileSelections).length > 0) {
    state.mobileClientTabSelectionsByDeviceId = { ...state.mobileClientTabSelectionsByDeviceId }
    for (const [deviceId, selections] of Object.entries(prepared.mobileSelections)) {
      state.mobileClientTabSelectionsByDeviceId[deviceId] = {
        ...state.mobileClientTabSelectionsByDeviceId[deviceId],
        ...selections
      }
    }
  }
  if (prepared.uiRouting) {
    applyUiRouting(prepared.uiRouting, state)
  }
}

function prepareMobileSelections(
  incoming: OCCdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId'],
  state: PersistedState
): NonNullable<OCCdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']> {
  const result: NonNullable<
    OCCdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']
  > = {}
  const current = state.mobileClientTabSelectionsByDeviceId ?? {}
  for (const [deviceId, selections] of Object.entries(incoming ?? {})) {
    for (const [worktreeId, selection] of Object.entries(selections)) {
      const existing = current[deviceId]?.[worktreeId]
      if (
        existing &&
        serializeOCCdMigrationValue(existing) !== serializeOCCdMigrationValue(selection)
      ) {
        throw new Error(`occd_migration_client_state_conflict:mobile:${deviceId}:${worktreeId}`)
      }
      const deviceSelections = (result[deviceId] ??= {})
      deviceSelections[worktreeId] = structuredClone(selection)
    }
  }
  return result
}

type UiRoutingKey = keyof OCCdMigrationUiRoutingState
type UiRoutingFieldMerge<K extends UiRoutingKey> =
  /** Per-window filters stay on the desktop. */
  | 'desktop-only'
  /** Preserve the server's existing value. */
  | ((ui: PersistedState['ui'], value: NonNullable<OCCdMigrationUiRoutingState[K]>) => void)

// View state cannot block a move: preserve server values and merge acknowledgements by latest time.
export const OCCD_MIGRATION_UI_ROUTING_MERGE: {
  readonly [K in UiRoutingKey]: UiRoutingFieldMerge<K>
} = {
  lastActiveRepoId: (ui, value) => {
    ui.lastActiveRepoId ??= value
  },
  lastActiveWorktreeId: (ui, value) => {
    ui.lastActiveWorktreeId ??= value
  },
  manualRepoOrder: (ui, value) => {
    if (!ui.manualRepoOrder?.length) {
      ui.manualRepoOrder = structuredClone(value)
    }
  },
  showDotfilesByWorktree: (ui, value) => {
    ui.showDotfilesByWorktree = { ...structuredClone(value), ...ui.showDotfilesByWorktree }
  },
  acknowledgedAgentsByPaneKey: (ui, value) => {
    // A retry must not revive an already-acknowledged unread mark.
    const merged = { ...ui.acknowledgedAgentsByPaneKey }
    for (const [paneKey, at] of Object.entries(value)) {
      merged[paneKey] = Math.max(merged[paneKey] ?? 0, at)
    }
    ui.acknowledgedAgentsByPaneKey = merged
  },
  setupScriptPromptDismissedRepoIds: (ui, value) => {
    ui.setupScriptPromptDismissedRepoIds = [
      ...new Set([...(ui.setupScriptPromptDismissedRepoIds ?? []), ...value])
    ]
  },
  filterRepoIds: 'desktop-only',
  workspaceHostScope: 'desktop-only',
  visibleWorkspaceHostIds: 'desktop-only',
  workspaceHostOrder: 'desktop-only',
  automationHostFilter: 'desktop-only'
}

const UI_ROUTING_KEYS = Object.keys(OCCD_MIGRATION_UI_ROUTING_MERGE).filter(isUiRoutingKey)

function isUiRoutingKey(key: string): key is UiRoutingKey {
  return Object.hasOwn(OCCD_MIGRATION_UI_ROUTING_MERGE, key)
}

function applyUiRouting(route: OCCdMigrationUiRoutingState, state: PersistedState): void {
  for (const key of UI_ROUTING_KEYS) {
    mergeUiRoutingField(key, route, state.ui)
  }
}

function mergeUiRoutingField<K extends UiRoutingKey>(
  key: K,
  route: OCCdMigrationUiRoutingState,
  ui: PersistedState['ui']
): void {
  const merge = OCCD_MIGRATION_UI_ROUTING_MERGE[key]
  const value = route[key]
  if (merge !== 'desktop-only' && value !== undefined && value !== null) {
    merge(ui, value)
  }
}
