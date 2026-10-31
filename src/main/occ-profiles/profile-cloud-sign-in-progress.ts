import type { OCCCloudSignInProgress } from '../../shared/occ-profiles'

type ProgressListener = (progress: OCCCloudSignInProgress | null) => void

// Only the newest attempt owns progress; late updates from older attempts are ignored.
let current: { attempt: number; link: string | null; cancel: () => void } | null = null
const listeners = new Set<ProgressListener>()

function snapshot(): OCCCloudSignInProgress | null {
  return current ? { link: current.link } : null
}

function update(next: typeof current): void {
  current = next
  const progress = snapshot()
  for (const listener of listeners) {
    try {
      listener(progress)
    } catch (error) {
      console.warn('[occ-profiles] Sign-in progress listener failed:', error)
    }
  }
}

export function getOCCCloudSignInProgress(): OCCCloudSignInProgress | null {
  return snapshot()
}

export function onOCCCloudSignInProgressChanged(listener: ProgressListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function startOCCCloudSignInProgress(attempt: number, cancel: () => void): void {
  update({ attempt, link: null, cancel })
}

export function setOCCCloudSignInLink(attempt: number, link: string | null): void {
  if (current?.attempt === attempt && current.link !== link) {
    update({ ...current, link })
  }
}

export function endOCCCloudSignInProgress(attempt?: number): void {
  if (current && (attempt === undefined || current.attempt === attempt)) {
    update(null)
  }
}

export function cancelOCCCloudSignIn(): void {
  current?.cancel()
}
