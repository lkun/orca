// A content-addressed Node script avoids cmd/PowerShell quoting and EDR-scored encoded execution; base64 replies survive console code pages.
import { createHash } from 'node:crypto'
import {
  OCCD_LAUNCHER_FILENAME,
  OCCD_SERVER_ENTRY_FILENAME,
  OCCD_NODE_RUNTIME_DIR_PREFIX,
  OCCD_NODE_RUNTIME_MARKER_FILENAME,
  OCCD_NODE_RUNTIME_WINDOWS_EXECUTABLE,
  OCCD_RUNTIMES_DIRNAME,
  OCCD_WINDOWS_PROCESS_TREE_FILENAME
} from '../../../shared/occd-artifacts'
import {
  OCCD_STOP_REQUEST_FILENAME,
  OCCD_STOP_REQUESTS_CAPABILITY
} from '../../../shared/occd-stop-request'
import { OCCD_STDIO_BRIDGE_FUNCTION } from '../lifecycle/occd-stdio-bridge-script'
import {
  OCCD_WINDOWS_FENCE_PRELUDE,
  OCCD_WINDOWS_HOST_FENCE_OPS
} from './occd-windows-host-fence-ops'
import {
  OCCD_WINDOWS_HOST_STATE_OPS,
  type OCCdWindowsHostStateOp
} from './occd-windows-host-state-ops'
import {
  OCCD_READINESS_FILENAME,
  OCCD_READINESS_MAX_BYTES,
  OCCD_WINDOWS_PROCESS_FILENAME
} from '../install/occd-remote-host-support'

export const OCCD_RECORD_ABSENT_MARKER = '__OCCD_RECORD_ABSENT__'
export const OCCD_RECORD_PRESENT_MARKER = '__OCCD_RECORD_PRESENT__'
export const OCCD_BUILD_HASH_MARKER = '__OCCD_BUILD_HASH__'
export const OCCD_WINDOWS_READINESS_MARKER = '__OCCD_READINESS__'
export const OCCD_WINDOWS_RUNTIME_MARKER = '__OCCD_RUNTIME__'
export const OCCD_WINDOWS_ENTRY_MARKER = '__OCCD_ENTRY__'
export const OCCD_WINDOWS_LIVENESS_MANY_MARKER = '__OCCD_LIVENESS__'
export const OCCD_WINDOWS_LOG_TAIL_MARKER = '__OCCD_LOG_TAIL__'
export const OCCD_WINDOWS_RUNTIME_MISSING_EXIT = 78
export const OCCD_WINDOWS_RECORD_UNREADABLE_EXIT = 65

export type OCCdWindowsHostOp =
  | 'liveness'
  | 'liveness-many'
  | 'stop'
  | 'readiness-wait'
  | 'log-tail'
  | 'build-hash'
  | 'record-read'
  | 'record-publish'
  | 'slot-runtime'
  | 'remove-file'
  | 'remove-tree'
  | 'fence-check'
  | 'fence-release'
  | 'fence-exited-owner'
  | 'script-present'
  | 'script-install'
  | 'stdio-bridge'
  | OCCdWindowsHostStateOp

const text = JSON.stringify
export const OCCD_WINDOWS_HOST_SCRIPT_PRESENT = 'OCCD_HOST_SCRIPT_PRESENT'

export const OCCD_WINDOWS_HOST_SCRIPT = `'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

${OCCD_WINDOWS_FENCE_PRELUDE}
const [op, ...args] = fencedArgv(process.argv.slice(2))
const answer = (value) => process.stdout.write(value, () => process.exit(0))
const encoded = (marker, buffer) => answer(marker + ' ' + buffer.toString('base64') + '\\n')

// A missing or unreadable file is "nothing yet", as POSIX \`head ... || true\` reads it.
function readHead(file, cap) {
  let fd
  try { fd = fs.openSync(file, 'r') } catch { return Buffer.alloc(0) }
  try {
    const buffer = Buffer.alloc(cap + 1)
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, cap + 1, 0))
  } catch { return Buffer.alloc(0) } finally { fs.closeSync(fd) }
}

function occdRecord(dir) {
  let record
  try { record = JSON.parse(fs.readFileSync(path.join(dir, ${text(OCCD_WINDOWS_PROCESS_FILENAME)}), 'utf8')) } catch { return null }
  return record && Number.isSafeInteger(record.pid) && record.pid > 0 ? record : null
}

// A PID alone is no identity on Windows: it must run AND carry the recorded creation time.
function occdState(dir, record) {
  // ESRCH is the only proof of absence; EPERM means some process holds the PID.
  try { process.kill(record.pid, 0) } catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown' }
  if (typeof record.creationTimeMs !== 'number') return 'unknown'
  let created
  try { created = require(path.join(dir, ${text(OCCD_WINDOWS_PROCESS_TREE_FILENAME)})).getProcessCreationTime(record.pid) } catch { return 'unknown' }
  if (typeof created !== 'number') return 'unknown'
  return created === record.creationTimeMs ? 'alive' : 'dead'
}

function readiness(dir) {
  const buffer = readHead(path.join(dir, ${text(OCCD_READINESS_FILENAME)}), ${OCCD_READINESS_MAX_BYTES})
  if (buffer.length > ${OCCD_READINESS_MAX_BYTES}) return null
  const line = buffer.toString('utf8').split('\\n').find((candidate) => candidate.trim().startsWith('{'))
  try { return line ? JSON.parse(line) : null } catch { return null }
}

// A launch creates the readiness file first, so a slot with neither it nor a process record
// never launched: like DEAD, that is proven exit (GC may remove it, a wake may start it).
function livenessWord(dir) {
  const launched = [${text(OCCD_WINDOWS_PROCESS_FILENAME)}, ${text(OCCD_READINESS_FILENAME)}]
  if (!launched.some((name) => fs.existsSync(path.join(dir, name)))) {
    return ${text('NEVER_LAUNCHED')}
  }
  const record = occdRecord(dir)
  const state = record ? occdState(dir, record) : 'unknown'
  return state === 'alive' ? 'LIVE' : state === 'dead' ? 'DEAD' : 'UNKNOWN'
}

const ops = {
  liveness(dir) {
    answer(livenessWord(dir))
  },

  // One process for a whole GC pass: a node.exe per version dir is the burst EDR scores.
  'liveness-many'(...dirs) {
    const states = dirs.map(livenessWord)
    answer(${text(`${OCCD_WINDOWS_LIVENESS_MANY_MARKER} `)} + states.join(',') + '\\n')
  },

  // Never a signal: on Windows that is TerminateProcess, which skips the durable shutdown.
  stop(dir, waitArg, launchedArg) {
    const record = occdRecord(dir)
    if (!record) return answer('NO_PID')
    const ready = readiness(dir)
    if (ready && ready.type === 'occ_server_ready') {
      const health = ready.health || {}
      // The readiness PID must corroborate the launcher's, so a reused PID is never addressed.
      if (health.pid !== record.pid) return answer('UNKNOWN')
      if (health.stopRequests !== ${OCCD_STOP_REQUESTS_CAPABILITY}) return answer('UNSUPPORTED')
    } else if (launchedArg !== '1') {
      return answer('UNKNOWN')
    }
    // A just-launched candidate's listener consumes a request written before it started.
    const first = occdState(dir, record)
    if (first === 'dead') return answer('ALREADY_EXITED')
    if (first !== 'alive') return answer('UNKNOWN')
    try { fs.writeFileSync(path.join(dir, ${text(OCCD_STOP_REQUEST_FILENAME)}), '', { mode: 0o600 }) } catch { return answer('SIGNAL_FAILED') }
    process.stdout.write('SIGNALED\\n')
    const end = Date.now() + Number(waitArg) * 1000
    const tick = () => {
      const state = occdState(dir, record)
      if (state === 'dead') return answer('STOPPED')
      if (Date.now() >= end) return answer(state === 'alive' ? 'STILL_RUNNING' : 'UNKNOWN')
      setTimeout(tick, 250)
    }
    tick()
  },

  // Settles on a finished line or an oversized file; both are final for the client's parser.
  'readiness-wait'(file, capArg, waitArg) {
    const cap = Number(capArg)
    const end = Date.now() + Number(waitArg) * 1000
    const tick = () => {
      const buffer = readHead(file, cap)
      if (buffer.includes(10) || buffer.length > cap || Date.now() >= end) {
        return encoded(${text(OCCD_WINDOWS_READINESS_MARKER)}, buffer)
      }
      setTimeout(tick, 200)
    }
    tick()
  },

  // The last bytes of a log, as POSIX \`tail -c\` reads them; a missing log is empty.
  'log-tail'(file, capArg) {
    const cap = Number(capArg)
    let fd
    try { fd = fs.openSync(file, 'r') } catch { return encoded(${text(OCCD_WINDOWS_LOG_TAIL_MARKER)}, Buffer.alloc(0)) }
    let buffer = Buffer.alloc(0)
    try {
      const size = fs.fstatSync(fd).size
      const length = Math.min(cap, size)
      buffer = Buffer.alloc(length)
      buffer = buffer.subarray(0, fs.readSync(fd, buffer, 0, length, size - length))
    } catch { buffer = Buffer.alloc(0) } finally { fs.closeSync(fd) }
    encoded(${text(OCCD_WINDOWS_LOG_TAIL_MARKER)}, buffer)
  },

  'build-hash'(file) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    answer(${text(`${OCCD_BUILD_HASH_MARKER} `)} + digest.slice(0, 16) + '\\n')
  },

  'record-read'(file, maxArg) {
    const max = Number(maxArg)
    let stats
    try { stats = fs.lstatSync(file) } catch (error) {
      if (error.code === 'ENOENT') return answer(${text(`${OCCD_RECORD_ABSENT_MARKER}\n`)})
      process.exit(${OCCD_WINDOWS_RECORD_UNREADABLE_EXIT})
    }
    if (!stats.isFile() || stats.size > max) process.exit(${OCCD_WINDOWS_RECORD_UNREADABLE_EXIT})
    const fd = fs.openSync(file, 'r')
    let buffer = Buffer.alloc(max + 1)
    try { buffer = buffer.subarray(0, fs.readSync(fd, buffer, 0, max + 1, 0)) } finally { fs.closeSync(fd) }
    if (buffer.length > max) process.exit(${OCCD_WINDOWS_RECORD_UNREADABLE_EXIT})
    encoded(${text(OCCD_RECORD_PRESENT_MARKER)}, buffer)
  },

  // Antivirus holding the record open shows up as EPERM/EACCES/EBUSY; retry briefly.
  'record-publish'(staged, file) {
    const fd = fs.openSync(staged, 'r+')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    const delays = [50, 100, 150, 200, 250]
    let attempt = 0
    const publish = () => {
      try { fs.renameSync(staged, file) } catch (error) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && attempt < delays.length) {
          setTimeout(publish, delays[attempt++])
          return
        }
        throw error
      }
      answer('')
    }
    publish()
  },

  // Loading at all proves this content-addressed file is whole.
  'script-present'() {
    answer(${text(OCCD_WINDOWS_HOST_SCRIPT_PRESENT)})
  },

  // Run from its own partial upload: moves itself over the script path. A concurrent writer
  // may already have put identical bytes there, so only a missing result is a failure.
  'script-install'(target) {
    try { fs.renameSync(__filename, target) } catch {}
    fs.rmSync(__filename, { force: true })
    answer(fs.existsSync(target) ? ${text(OCCD_WINDOWS_HOST_SCRIPT_PRESENT)} : '')
  },

  'remove-file'(file) {
    try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
    answer('')
  },

  'remove-tree'(target) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5 })
    answer('')
  },

  // The node.exe a slot's marker names; with clear-stop-request, also drops a stale request.
  'slot-runtime'(slotDir, mode) {
    let sha
    try { sha = fs.readFileSync(path.join(slotDir, ${text(OCCD_NODE_RUNTIME_MARKER_FILENAME)}), 'utf8').trim() } catch { process.exit(${OCCD_WINDOWS_RUNTIME_MISSING_EXIT}) }
    // The digest becomes a path segment, so only a bare sha256 may reach it.
    if (!/^[0-9a-f]{64}$/.test(sha)) process.exit(${OCCD_WINDOWS_RUNTIME_MISSING_EXIT})
    const runtime = path.join(path.dirname(slotDir), ${text(OCCD_RUNTIMES_DIRNAME)}, ${text(OCCD_NODE_RUNTIME_DIR_PREFIX)} + sha, ${text(OCCD_NODE_RUNTIME_WINDOWS_EXECUTABLE)})
    try { if (!fs.statSync(runtime).isFile()) process.exit(${OCCD_WINDOWS_RUNTIME_MISSING_EXIT}) } catch { process.exit(${OCCD_WINDOWS_RUNTIME_MISSING_EXIT}) }
    if (mode === 'clear-stop-request') {
      try { fs.unlinkSync(path.join(slotDir, ${text(OCCD_STOP_REQUEST_FILENAME)})) } catch (error) { if (error.code !== 'ENOENT') process.exit(1) }
    }
    const server = path.join(slotDir, ${text(OCCD_SERVER_ENTRY_FILENAME)})
    const entry = fs.existsSync(server) ? server : path.join(slotDir, ${text(OCCD_LAUNCHER_FILENAME)})
    answer([
      [${text(OCCD_WINDOWS_RUNTIME_MARKER)}, Buffer.from(runtime, 'utf8').toString('base64')].join(' '),
      [${text(OCCD_WINDOWS_ENTRY_MARKER)}, Buffer.from(entry, 'utf8').toString('base64')].join(' '),
      ''
    ].join('\\n'))
  },

  // Never exits on its own: it lives as long as the client's exec channel or occd's socket.
  'stdio-bridge'(portArg) {
    occdStdioBridge(Number(portArg), 'base64')
  }
}

${OCCD_STDIO_BRIDGE_FUNCTION}

${OCCD_WINDOWS_HOST_STATE_OPS}
${OCCD_WINDOWS_HOST_FENCE_OPS}
const run = Object.hasOwn(ops, op) ? ops[op] : null
if (!run) {
  process.stderr.write('unknown occd host op: ' + String(op) + '\\n')
  process.exit(64)
}
run(...args)
`

export const OCCD_WINDOWS_HOST_SCRIPT_FILENAME = `occd-host-script-${createHash('sha256')
  .update(OCCD_WINDOWS_HOST_SCRIPT)
  .digest('hex')
  .slice(0, 16)}.js`
