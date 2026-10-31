import { useAppStore } from '@/store'
import { OCC_BROWSER_PARTITION } from '../../../../../shared/constants'
import { getOCCProfileBrowserDefaultPartition } from '../../../../../shared/occ-profiles'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { unadmittedBrowserPartition } from '../../../../../shared/browser-profile-scope'

export function useBrowserPageWebviewPartition({
  sessionProfileId,
  sessionPartition
}: {
  sessionProfileId: string | null
  sessionPartition: string | null
}): string {
  // Why the local list first: this webview renders here, while Settings may be showing a paired host's profiles.
  const localProfiles = useAppStore(
    (s) => s.browserSessionProfilesByHostId[LOCAL_EXECUTION_HOST_ID]
  )
  const mirroredProfiles = useAppStore((s) => s.browserSessionProfiles)
  const browserSessionProfiles = localProfiles ?? mirroredProfiles
  const activeOCCProfileId = useAppStore((s) => s.activeOCCProfileId)
  const fallbackBrowserPartition = activeOCCProfileId
    ? getOCCProfileBrowserDefaultPartition(activeOCCProfileId)
    : null
  const defaultSessionProfile = browserSessionProfiles.find((p) => p.id === 'default') ?? null
  const sessionProfile = sessionProfileId
    ? (browserSessionProfiles.find((p) => p.id === sessionProfileId) ?? null)
    : defaultSessionProfile
  if (sessionPartition) {
    return sessionPartition
  }
  // Why: a profile missing from main's loaded list was deleted; its tab must load nowhere, not in Default's jar.
  if (sessionProfileId && !sessionProfile && localProfiles) {
    return unadmittedBrowserPartition(sessionProfileId)
  }
  return (
    sessionProfile?.partition ??
    defaultSessionProfile?.partition ??
    fallbackBrowserPartition ??
    OCC_BROWSER_PARTITION
  )
}
