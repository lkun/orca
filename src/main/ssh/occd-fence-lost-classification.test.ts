import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientChannel } from 'ssh2'
import { execOCCdStateMutation } from '../managed-server/host-state/occd-state-mutation-exec'
import {
  execOCCdRemote,
  execOCCdRemoteOr
} from '../managed-server/install/occd-remote-runtime-control'
import {
  OCCD_FENCE_LOST_MARKER,
  OCCdFenceLostError,
  isOCCdFenceLost,
  posixOCCdFenceGuard,
  runWithOCCdFence
} from '../managed-server/activation/occd-activation-fence-scope'
import {
  isUnconfirmedSshCommandTermination,
  sshCommandExitError
} from './remote-exec/remote-exec-command'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import type { OCCdHostTransport } from './occd-host-transport'

/** Model an exec channel whose unreachable host never acknowledges close. */
class HostChannel extends EventEmitter {
  readonly stderr = Object.assign(new EventEmitter(), { resume: () => {} })
  readonly stdin = this
  close(): void {}
  resume(): void {}
  exit(code: number, stdout: string): void {
    this.emit('data', Buffer.from(stdout))
    this.emit('close', code)
  }
}

let channel: HostChannel
const commands: string[] = []
const conn = {
  exec: async (command: string) => {
    commands.push(command)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand reads only the channel events, close() and resume() HostChannel implements.
    return channel as unknown as ClientChannel
  },
  usesSystemSshTransport: () => false
}
const target = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only exec and usesSystemSshTransport are read.
  conn: conn as unknown as OCCdHostTransport,
  host: getRemoteHostPlatform('linux-x64')
}
const fence = {
  lockDir: '/home/u/.occ-remote/.occd-activation-transaction/.install-lock',
  token: 't1'
}

const mutation = `${posixOCCdFenceGuard(fence)} restore`

function fenced<T>(run: () => Promise<T>): Promise<T> {
  return runWithOCCdFence(fence, run)
}

async function settledAfter(step: Promise<unknown>, answer: () => void): Promise<unknown> {
  const settled = step.catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(0)
  answer()
  return settled
}

beforeEach(() => {
  vi.useFakeTimers()
  channel = new HostChannel()
  commands.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

// Real exec errors quote commands that contain the guard marker; that alone must not imply fence loss.
describe('a fenced step through the real exec', () => {
  it('stays an ordinary failure when the step itself exits nonzero', async () => {
    const error = await settledAfter(
      fenced(() => execOCCdRemote(target, 'false')),
      () => channel.exit(1, 'boom\n')
    )
    expect(commands[0]).toContain(OCCD_FENCE_LOST_MARKER)
    expect(error).not.toBeInstanceOf(OCCdFenceLostError)
    expect(error).toMatchObject({ exitCode: 1, stdout: 'boom\n' })
  })

  it('lets a failed step fall back', async () => {
    const answer = await settledAfter(
      fenced(() => execOCCdRemoteOr(target, 'false', 'FALLBACK')),
      () => channel.exit(1, '')
    )
    expect(answer).toBe('FALLBACK')
  })

  it('keeps a timed-out step unconfirmed, so the fence is not released under it', async () => {
    const settled = fenced(() => execOCCdRemoteOr(target, 'sleep 99', 'FALLBACK')).catch(
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(60_000)
    const error = await settled
    expect(error).not.toBeInstanceOf(OCCdFenceLostError)
    expect(isUnconfirmedSshCommandTermination(error)).toBe(true)
  })

  it('reads the guard’s own exit as a lost fence', async () => {
    const error = await settledAfter(
      fenced(() => execOCCdRemote(target, 'true')),
      () => channel.exit(75, `${OCCD_FENCE_LOST_MARKER}\n`)
    )
    expect(error).toBeInstanceOf(OCCdFenceLostError)
  })

  it('does not read a marker-free exit 75 as a lost fence', async () => {
    const error = await settledAfter(
      fenced(() => execOCCdRemote(target, 'true')),
      () => channel.exit(75, 'other\n')
    )
    expect(error).not.toBeInstanceOf(OCCdFenceLostError)
  })
})

describe('a fenced state mutation through the real exec', () => {
  it('stays an ordinary failure when the mutation exits nonzero', async () => {
    const error = await settledAfter(
      fenced(() => execOCCdStateMutation(target, mutation)),
      () => channel.exit(2, 'no snapshot\n')
    )
    expect(error).not.toBeInstanceOf(OCCdFenceLostError)
    expect(isUnconfirmedSshCommandTermination(error)).toBe(false)
  })

  it('reads the guard’s own exit as a lost fence', async () => {
    const error = await settledAfter(
      fenced(() => execOCCdStateMutation(target, mutation)),
      () => channel.exit(75, `${OCCD_FENCE_LOST_MARKER}\n`)
    )
    expect(error).toBeInstanceOf(OCCdFenceLostError)
  })
})

describe('a Windows host op whose exit PowerShell flattened to 1', () => {
  it('is a lost fence only when the host script printed the marker', () => {
    const op = `powershell.exe -Command "& 'node.exe' 'host.js' --fence d t ${OCCD_FENCE_LOST_MARKER}"`
    expect(isOCCdFenceLost(sshCommandExitError(op, 1, `${OCCD_FENCE_LOST_MARKER}\r\n`))).toBe(
      true
    )
    expect(isOCCdFenceLost(sshCommandExitError(op, 1, 'ENOENT\r\n'))).toBe(false)
  })
})
