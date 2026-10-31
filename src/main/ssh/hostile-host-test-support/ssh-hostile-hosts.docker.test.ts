// Run real deploys against compatible container/loopback cells with OCC_RUN_SSH_HOSTILE_HOSTS=1; OCC_SSH_HOSTILE_HOST_CELLS narrows them.
// Build the selected occd template slots first: Linux glibc/musl for Docker or this macOS runner's architecture; ssh-hostile-hosts.yml runs the matrix.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { HOSTILE_HOST_CELLS, selectHostileHostCells } from './ssh-hostile-host-cells'
import { proveManagedOCCdCell } from './ssh-hostile-host-managed-occd'
import { installHostileHostAppEnvironment } from './ssh-hostile-host-test-harness'
import {
  hostileHostSshTarget,
  startHostileHostTarget,
  stopHostileHostTarget,
  type HostileHostTarget
} from './ssh-hostile-host-test-fixture'

const RUN = process.env.OCC_RUN_SSH_HOSTILE_HOSTS === '1'
const SELECTED = new Set(
  RUN ? selectHostileHostCells(process.env.OCC_SSH_HOSTILE_HOST_CELLS).map((cell) => cell.id) : []
)
const CELL_TIMEOUT_MS = 15 * 60_000

describe('SSH hostile-host managed occd matrix', () => {
  let cleanupAppEnvironment: (() => void) | null = null
  let executed = 0

  beforeAll(() => {
    cleanupAppEnvironment = installHostileHostAppEnvironment()
  })

  afterAll(() => {
    cleanupAppEnvironment?.()
    // An enabled job must deploy every selected cell; all-skipped is not success.
    if (RUN) {
      expect(executed).toBe(SELECTED.size)
    }
  })

  it.runIf(RUN)('selects at least one cell this machine can host', () => {
    expect(SELECTED.size).toBeGreaterThan(0)
  })

  for (const cell of HOSTILE_HOST_CELLS) {
    it.skipIf(!SELECTED.has(cell.id))(
      `${cell.id} deploys managed occd on ${cell.managed.runtime} (${cell.managed.outcome})`,
      async () => {
        executed += 1
        let target: HostileHostTarget | null = null
        try {
          target = await startHostileHostTarget(cell)
          await proveManagedOCCdCell(cell, target, hostileHostSshTarget(target))
        } finally {
          await stopHostileHostTarget(target)
        }
      },
      CELL_TIMEOUT_MS
    )
  }
})
