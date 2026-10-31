export const ORCHESTRATION_SETUP_STATE_EVENT = 'occ:orchestration-setup-state'
export const ORCHESTRATION_ENABLED_STORAGE_KEY = 'occ.orchestration.enabled'
export const ORCHESTRATION_SETUP_DISMISSED_STORAGE_KEY = 'occ.orchestration.setupDismissed'

export function isOrchestrationSetupEnabled(): boolean {
  return localStorage.getItem(ORCHESTRATION_ENABLED_STORAGE_KEY) === '1'
}

export function hasOrchestrationSetupMarker(): boolean {
  return isOrchestrationSetupEnabled()
}

export function markOrchestrationSetupComplete(): void {
  localStorage.setItem(ORCHESTRATION_ENABLED_STORAGE_KEY, '1')
  notifyOrchestrationSetupStateChanged()
}

export function isOrchestrationSetupDismissed(): boolean {
  return localStorage.getItem(ORCHESTRATION_SETUP_DISMISSED_STORAGE_KEY) === '1'
}

export function notifyOrchestrationSetupStateChanged(): void {
  window.dispatchEvent(new CustomEvent(ORCHESTRATION_SETUP_STATE_EVENT))
}
