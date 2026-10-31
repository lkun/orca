// Unreadable host records must not look absent: deploying over an unknown live install is unsafe.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { removeRemoteFileCommand } from '../../ssh/ssh-remote-commands'
import { execOCCdRemote, type OCCdRemoteExecTarget } from './occd-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { isWindowsRemoteHost } from '../../ssh/ssh-remote-platform'
import {
  occdRemoteBaseDir,
  occdWindowsHostOpCommand,
  readOCCdWindowsEncodedAnswer
} from './occd-remote-windows-node'
import {
  OCCD_RECORD_ABSENT_MARKER as ABSENT_MARKER,
  OCCD_RECORD_PRESENT_MARKER as PRESENT_MARKER
} from '../host-state/occd-windows-host-script'

/** Callers validate the schema of present records. */
type OCCdRemoteRecordRead = { state: 'absent' } | { state: 'present'; raw: string }

function windowsBaseDir(target: OCCdRemoteExecTarget): string {
  if (!target.remoteHome) {
    throw new Error(
      'occd host records on Windows need the remote home to find the pinned node.exe'
    )
  }
  return occdRemoteBaseDir(target.host, target.remoteHome)
}

export async function readBoundedOCCdRemoteRecord(
  target: OCCdRemoteExecTarget,
  path: string,
  maxBytes: number
): Promise<OCCdRemoteRecordRead> {
  if (isWindowsRemoteHost(target.host)) {
    return readWindowsRecord(target, path, maxBytes)
  }
  const file = quotePosixShell(path)
  // Explicit markers distinguish absent records from failed reads with empty stdout.
  const output = await execOCCdRemote(
    target,
    `if [ ! -e ${file} ] && [ ! -L ${file} ]; then printf '%s\\n' ${ABSENT_MARKER}; exit 0; fi; ` +
      `[ -f ${file} ] || exit 65; size=$(wc -c < ${file}) || exit 65; ` +
      `[ "$size" -le ${maxBytes} ] || exit 65; ` +
      `printf '%s\\n' ${PRESENT_MARKER}; cat ${file}`
  )
  const newline = output.indexOf('\n')
  const marker = (newline === -1 ? output : output.slice(0, newline)).trim()
  if (marker === ABSENT_MARKER) {
    return { state: 'absent' }
  }
  if (marker !== PRESENT_MARKER) {
    throw new Error('occd host record read returned no verifiable answer')
  }
  return { state: 'present', raw: newline === -1 ? '' : output.slice(newline + 1) }
}

async function readWindowsRecord(
  target: OCCdRemoteExecTarget,
  path: string,
  maxBytes: number
): Promise<OCCdRemoteRecordRead> {
  const output = await execOCCdRemote(
    target,
    occdWindowsHostOpCommand(target.host, windowsBaseDir(target), 'record-read', [
      path,
      String(maxBytes)
    ])
  )
  if (output.split(/\r?\n/u).some((line) => line.trim() === ABSENT_MARKER)) {
    return { state: 'absent' }
  }
  const raw = readOCCdWindowsEncodedAnswer(output, PRESENT_MARKER)
  if (raw === null) {
    throw new Error('occd host record read returned no verifiable answer')
  }
  return { state: 'present', raw }
}

export async function writeAtomicOCCdRemoteRecord(
  target: OCCdRemoteExecTarget,
  path: string,
  contents: string
): Promise<void> {
  const partialPath = `${path}.partial.${process.pid}.${randomUUID()}`
  const baseDir = isWindowsRemoteHost(target.host) ? windowsBaseDir(target) : null
  try {
    if (baseDir) {
      await target.conn.writeFile(partialPath, contents, {
        hostPlatform: target.host,
        signal: target.signal
      })
      await execOCCdRemote(
        target,
        occdWindowsHostOpCommand(target.host, baseDir, 'record-publish', [partialPath, path])
      )
      return
    }
    await execOCCdRemote(
      target,
      `umask 077; printf %s ${quotePosixShell(contents)} > ${quotePosixShell(partialPath)} && ` +
        `mv -f ${quotePosixShell(partialPath)} ${quotePosixShell(path)}`
    )
  } catch (error) {
    // Unconfirmed writes may still be running; preserve their partial file.
    if (!isUnconfirmedSshCommandTermination(error)) {
      const discard = baseDir
        ? occdWindowsHostOpCommand(target.host, baseDir, 'remove-file', [partialPath])
        : removeRemoteFileCommand(target.host, partialPath)
      await execOCCdRemote(target, discard).catch(() => {})
    }
    throw error
  }
}
