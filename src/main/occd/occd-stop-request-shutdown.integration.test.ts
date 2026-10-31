// Windows signals skip graceful cleanup; prove the packaged stop-file path flushes and releases locks.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '@occ/process-host'
import { OCCD_NODE_RUNTIME_MARKER_FILENAME } from '../../shared/occd-artifacts'
import { OCCD_STOP_REQUEST_FILENAME } from '../../shared/occd-stop-request'
import {
  killChildAndWait,
  killProfileDaemons,
  recordProfileDaemons,
  removeTestRoot
} from './occd-daemon-teardown-fixture'
import { parseOCCdReadinessOutput } from '../managed-server/install/occd-remote-launch'
import { OCCD_LOCK_FILE_NAME, readOCCdInstanceLockRecord } from './occd-instance-lock'
import { OCCD_SHUTDOWN_DEADLINE_MS } from './occd-stop-deadlines'
import {
  installPackagedOCCdSlotForTests,
  locatePinnedNodeForTests,
  skipForMissingInputs
} from './occd-node-slot-fixture'

const pinnedNode = locatePinnedNodeForTests()
const skip = skipForMissingInputs('artifact', [
  ...(pinnedNode ? [] : ['the pinned Node (OCC_PINNED_NODE or out/runtimes)']),
  ...(existsSync(join('out/occd', OCCD_NODE_RUNTIME_MARKER_FILENAME))
    ? []
    : ['a Node occd slot in out/occd (pnpm build:occd)'])
])

let root = ''
const children: ReturnType<typeof spawnProcess>[] = []

/** Clear Vitest markers so daemon-entry starts its server. */
function hostEnv(userData: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV')
    ),
    OCC_BACKGROUND_LAUNCH: '1',
    OCC_DISABLE_MACOS_LOGIN_SHELL: '1',
    OCC_VERSION: '0.0.0-stop-request-test',
    OCC_USER_DATA: userData
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    await killChildAndWait(child)
  }
  if (root) {
    // Daemons outlive the server; stop them before deleting their data root.
    await killProfileDaemons(join(root, 'data'))
    await removeTestRoot(root)
  }
  // Cold Windows arm64 slots can take over a minute to delete.
}, 180_000)

describe.skipIf(skip)('packaged occd stop request', () => {
  it(`stops cleanly within ${OCCD_SHUTDOWN_DEADLINE_MS} ms of its slot's stop-request file`, async () => {
    root = mkdtempSync(join(tmpdir(), 'occd-stop-request-'))
    const { slotDir, runtime } = installPackagedOCCdSlotForTests(root, pinnedNode!)
    const userData = join(root, 'data')
    const launchedAt = Date.now()
    const child = spawnProcess({
      program: runtime,
      args: [join(slotDir, 'occd.js'), '--json', '--bind', '127.0.0.1', '--port', '0'],
      cwd: slotDir,
      env: hostEnv(userData),
      timeoutMs: null
    })
    children.push(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))

    await vi.waitFor(
      () => {
        const parsed = parseOCCdReadinessOutput(stdout)
        if (parsed.state !== 'ready') {
          throw new Error(`occd not ready (${parsed.state}): ${stderr.slice(-2000)}`)
        }
        expect(parsed.readiness.health?.stopRequests).toBe(1)
      },
      { timeout: 90_000, interval: 250 }
    )

    const lock = readOCCdInstanceLockRecord(join(userData, OCCD_LOCK_FILE_NAME))
    expect(lock?.pid).toBe(child.pid)
    expect(lock?.startedAtMs).toEqual(expect.any(Number))
    expect(Math.abs(lock!.startedAtMs! - launchedAt)).toBeLessThan(30_000)

    await recordProfileDaemons(userData)
    const requestedAt = Date.now()
    writeFileSync(join(slotDir, OCCD_STOP_REQUEST_FILENAME), '')
    const code = await exited
    const elapsedMs = Date.now() - requestedAt
    expect(code, stderr.slice(-2000)).toBe(0)
    expect(elapsedMs).toBeLessThan(OCCD_SHUTDOWN_DEADLINE_MS)
    expect(existsSync(join(userData, OCCD_LOCK_FILE_NAME))).toBe(false)
    expect(existsSync(join(slotDir, OCCD_STOP_REQUEST_FILENAME))).toBe(false)
  }, 150_000)
})
