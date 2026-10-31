type OCCCloudSessionInvalidationListener = () => void

const listeners = new Set<OCCCloudSessionInvalidationListener>()

/** Auth-failure invalidation only; explicit sign-out returns fresh status directly. */
export function onOCCCloudSessionInvalidated(
  listener: OCCCloudSessionInvalidationListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitOCCCloudSessionInvalidated(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(
        '[occ-profiles] Cloud session invalidation listener failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
