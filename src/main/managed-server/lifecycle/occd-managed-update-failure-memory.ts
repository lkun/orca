// Remember failures only for this session so restarting retries once.
export type OCCdUpdateFailureHost = { kind: 'ssh' | 'wsl'; id: string }

export type OCCdUpdateFailure = { code: string; reason: string }

const failedThisLaunch = new Map<string, OCCdUpdateFailure>()

function key(host: OCCdUpdateFailureHost): string {
  return `${host.kind}:${host.id}`
}

export function recordOCCdUpdateFailedThisLaunch(
  host: OCCdUpdateFailureHost,
  failure: OCCdUpdateFailure
): void {
  failedThisLaunch.set(key(host), failure)
}

export function occdUpdateFailureThisLaunch(
  host: OCCdUpdateFailureHost
): OCCdUpdateFailure | null {
  return failedThisLaunch.get(key(host)) ?? null
}

export function occdUpdateFailedThisLaunch(host: OCCdUpdateFailureHost): boolean {
  return failedThisLaunch.has(key(host))
}

export function clearOCCdUpdateFailedThisLaunch(host: OCCdUpdateFailureHost): void {
  failedThisLaunch.delete(key(host))
}

export function resetOCCdUpdateFailuresForTests(): void {
  failedThisLaunch.clear()
}
