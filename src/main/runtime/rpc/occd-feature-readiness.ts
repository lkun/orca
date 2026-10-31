/**
 * Startup phases an occd host finishes after its first RPC could arrive. A method that needs one
 * declares it (`requires`); the dispatcher waits a bounded time, then refuses retryably. Hosts that
 * never install a readiness (the desktop) have every feature open.
 */
export type OCCdFeature = 'accounts' | 'sessionSearch' | 'orchestration' | 'unshownPlacement'

export const OCCD_FEATURES: readonly OCCdFeature[] = [
  'accounts',
  'sessionSearch',
  'orchestration',
  'unshownPlacement'
]

// Long enough to ride out a cold start; short enough that a caller's own retry takes over.
export const OCCD_FEATURE_WAIT_MS = 10_000

export class OCCdFeatureReadiness {
  private readonly pending = new Map<OCCdFeature, { opened: Promise<void>; open: () => void }>()

  constructor(closed: readonly OCCdFeature[] = []) {
    for (const feature of closed) {
      let open!: () => void
      const opened = new Promise<void>((resolve) => {
        open = resolve
      })
      this.pending.set(feature, { opened, open })
    }
  }

  isOpen(feature: OCCdFeature): boolean {
    return !this.pending.has(feature)
  }

  open(feature: OCCdFeature): void {
    this.pending.get(feature)?.open()
    this.pending.delete(feature)
  }

  /**
   * 'ready' once every feature is open; 'timeout' if any is still closed after `timeoutMs`;
   * 'aborted' as soon as any signal aborts (the client went away).
   */
  async waitFor(
    features: readonly OCCdFeature[],
    timeoutMs: number,
    signals: readonly (AbortSignal | undefined)[] = []
  ): Promise<'ready' | 'timeout' | 'aborted'> {
    const live = signals.filter((signal): signal is AbortSignal => signal !== undefined)
    if (live.some((signal) => signal.aborted)) {
      return 'aborted'
    }
    const waits = features.flatMap((feature) => this.pending.get(feature)?.opened ?? [])
    if (waits.length === 0) {
      return 'ready'
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanups: (() => void)[] = []
    const settled = new Promise<'timeout' | 'aborted'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
      for (const signal of live) {
        const onAbort = (): void => resolve('aborted')
        signal.addEventListener('abort', onAbort, { once: true })
        cleanups.push(() => signal.removeEventListener('abort', onAbort))
      }
    })
    try {
      return await Promise.race([Promise.all(waits).then(() => 'ready' as const), settled])
    } finally {
      clearTimeout(timer)
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }
}

// One runtime per occd process; the desktop's never installs one, so all features read open.
let current = new OCCdFeatureReadiness()

export function occdFeatureReadiness(): OCCdFeatureReadiness {
  return current
}

/** occd startup: every feature starts closed and opens where its phase finishes. */
export function installOCCdFeatureReadiness(): OCCdFeatureReadiness {
  current = new OCCdFeatureReadiness(OCCD_FEATURES)
  return current
}

export function _resetOCCdFeatureReadinessForTests(): void {
  current = new OCCdFeatureReadiness()
}

/** A method's startup needs: fixed, or read from its parsed params (an agent launch, not a shell). */
export type OCCdFeatureRequirement<P = never> =
  | readonly OCCdFeature[]
  | ((params: P) => readonly OCCdFeature[])

export function resolveOCCdFeatureRequirement<P>(
  requires: OCCdFeatureRequirement<P> | undefined,
  params: P
): readonly OCCdFeature[] {
  return typeof requires === 'function' ? requires(params) : (requires ?? [])
}

/**
 * The wait for a method's required features, or null when nothing is closed, so ungated dispatch
 * keeps its synchronous start. Refuses with the existing retryable `runtime_unavailable`, also when
 * the request or its connection ends while waiting: the handler must never run for a caller that
 * left (a streaming handler's close cleanup would never fire; a retried mutation would run twice).
 */
export function rpcMethodFeatureWait(
  requires: readonly OCCdFeature[],
  signals: readonly (AbortSignal | undefined)[] = [],
  timeoutMs = OCCD_FEATURE_WAIT_MS
): Promise<void> | null {
  if (!requires.some((feature) => !current.isOpen(feature))) {
    return null
  }
  return current.waitFor(requires, timeoutMs, signals).then((outcome) => {
    if (outcome !== 'ready') {
      throw new Error('runtime_unavailable')
    }
  })
}

/** Adds `feature` to each method of a family, e.g. every `orchestration.*` method. */
export function requiringOCCdFeature<
  M extends { readonly requires?: OCCdFeatureRequirement<never> }
>(feature: OCCdFeature, methods: readonly M[]): M[] {
  return methods.map((method) => {
    const own = method.requires
    return {
      ...method,
      requires:
        typeof own === 'function'
          ? (params: never) => [...own(params), feature]
          : [...(own ?? []), feature]
    }
  })
}
