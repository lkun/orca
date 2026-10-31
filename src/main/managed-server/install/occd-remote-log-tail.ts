// Decorate logged errors with a bounded redacted host tail, never telemetry; missing host evidence preserves the original failure.
import { redactString } from '../../observability/redactor'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { OCCD_LOG_FILENAME } from './occd-remote-host-support'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  occdWindowsSlotOpCommand,
  readOCCdWindowsEncodedAnswer
} from './occd-remote-windows-node'
import { OCCD_WINDOWS_LOG_TAIL_MARKER } from '../host-state/occd-windows-host-script'
import type { OCCdRemoteExecTarget } from './occd-remote-runtime-control'

export const OCCD_LOG_TAIL_LINES = 40
export const OCCD_LOG_TAIL_MAX_BYTES = 8 * 1024
// Error decoration must not add an unbounded delay.
const OCCD_LOG_TAIL_TIMEOUT_MS = 10_000

export function occdLogTailCommand(host: RemoteHostPlatform, slotDir: string): string {
  const log = joinRemotePath(host, slotDir, OCCD_LOG_FILENAME)
  if (isWindowsRemoteHost(host)) {
    return occdWindowsSlotOpCommand(host, slotDir, 'log-tail', [
      log,
      String(OCCD_LOG_TAIL_MAX_BYTES)
    ])
  }
  return `tail -c ${OCCD_LOG_TAIL_MAX_BYTES} ${quotePosixShell(log)} 2>/dev/null || true`
}

export function parseOCCdLogTail(host: RemoteHostPlatform, output: string): string | null {
  const raw = isWindowsRemoteHost(host)
    ? (readOCCdWindowsEncodedAnswer(output, OCCD_WINDOWS_LOG_TAIL_MARKER) ?? '')
    : output
  const bounded = Buffer.from(raw, 'utf8').subarray(-OCCD_LOG_TAIL_MAX_BYTES).toString('utf8')
  const lines = bounded.replace(/\s+$/u, '').split(/\r?\n/u).slice(-OCCD_LOG_TAIL_LINES)
  const tail = redactString(lines.join('\n'))
  return tail.trim() ? tail : null
}

async function readOCCdLogTail(
  target: OCCdRemoteExecTarget,
  slotDir: string
): Promise<string | null> {
  try {
    // Observe cancellation failures without reusing the already-aborted request signal.
    const output = await execCommand(target.conn, occdLogTailCommand(target.host, slotDir), {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: OCCD_LOG_TAIL_TIMEOUT_MS
    })
    return parseOCCdLogTail(target.host, output)
  } catch (error) {
    console.warn('[ssh] Could not read the occd.log tail:', error)
    return null
  }
}

export async function withOCCdLogTail(
  target: OCCdRemoteExecTarget,
  slotDir: string,
  message: string
): Promise<string> {
  const tail = await readOCCdLogTail(target, slotDir)
  return tail ? `${message}\nLast lines of occd.log:\n${tail}` : message
}
