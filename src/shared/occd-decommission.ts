import type { OCCdManagedRefusal } from './occd-managed-runtime'
import type { OCCdDaemonRetirementVerdict } from './occd-stop-request'

export type OCCdDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: OCCdDaemonRetirementVerdict
    }
  | OCCdManagedRefusal
