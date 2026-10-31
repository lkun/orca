import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from './electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'occ-runtime.json'
let occDevUserDataPath: string | null = null
let occServeProcess: ChildProcess | null = null
let occServeStdout = ''
let occServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunOCCCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runOCCCli(
  args: string[],
  options: RunOCCCliOptions = {}
): Promise<CliResult> {
  try {
    return await runOCCCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Windows can lose the dev runtime while launching the fixture app; reopen once before the desktop action.
      await ensureOCCRuntimeLaunched()
      return await runOCCCliOnce(args)
    }
    throw error
  }
}

async function runOCCCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/occ-dev.mjs')
  const command = process.env.OCC_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.OCC_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.OCC_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureOCCRuntimeLaunched(): Promise<void> {
  if (!process.env.OCC_COMPUTER_CLI && process.platform === 'win32') {
    await ensureOCCRuntimeServed()
    return
  }
  await runOCCCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForOCCRuntimeReady()
}

export async function stopOCCRuntime(): Promise<void> {
  const processToStop = occServeProcess
  if (!processToStop?.pid) {
    return
  }
  occServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eOCCDevUserDataPath(): Promise<string> {
  if (!occDevUserDataPath) {
    // Use a fresh profile so a retained dev runtime cannot execute stale provider code.
    occDevUserDataPath = await mkdtemp(join(tmpdir(), 'occ-computer-runtime-'))
  }
  return occDevUserDataPath
}

async function waitForOCCRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eOCCDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runOCCCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    occServeStdout.trim() ? `serve stdout: ${occServeStdout.trim()}` : null,
    occServeStderr.trim() ? `serve stderr: ${occServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`OCC runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureOCCRuntimeServed(): Promise<void> {
  if (!occServeProcess || occServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/occ-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    occServeStdout = ''
    occServeStderr = ''
    occServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    occServeProcess.stdout?.on('data', (chunk) => {
      occServeStdout += String(chunk)
    })
    occServeProcess.stderr?.on('data', (chunk) => {
      occServeStderr += String(chunk)
    })
    occServeProcess.once('exit', () => {
      occServeProcess = null
    })
    process.once('exit', () => {
      occServeProcess?.kill()
    })
  }
  await waitForOCCRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.OCC_DEV_USER_DATA_PATH ?? (await getComputerE2eOCCDevUserDataPath())
  // Strip ELECTRON_RUN_AS_NODE or the Electron child runs as plain Node.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Keep CLI and Electron on the same runtime metadata while fixture HOME/Codex isolation remains in force.
    OCC_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read OCC runtime metadata')
  )
}
