import { realpathSync } from 'node:fs'
import { runProcess } from '@occ/process-host'
import {
  PROFILE_STATE_RECOVERY_FLAG,
  PROFILE_STATE_RECOVERY_RESULT_PREFIX,
  profileStateRecoveryResponseSchema,
  type ProfileStateRecoveryRequest,
  type ProfileStateRollbackResult
} from '../../shared/profile-state-recovery-command'
import {
  getExecutableAppArgs,
  resolveAppRoot,
  resolveForegroundOCCExecutable,
  stripElectronRunAsNode
} from './occ-app-executable'
import { RuntimeClientError } from './types'
import { canStartOCCServer } from './serve-app-launcher'

export function canLaunchProfileStateRecovery(): boolean {
  return canStartOCCServer(process.env)
}

export async function launchProfileStateRecovery(
  request: ProfileStateRecoveryRequest
): Promise<ProfileStateRollbackResult> {
  const executable = resolveForegroundOCCExecutable()
  const userDataPath = realpathSync(request.userDataPath)
  const response = await runProcess({
    program: executable,
    args: [
      ...getExecutableAppArgs(executable),
      '--serve',
      PROFILE_STATE_RECOVERY_FLAG,
      JSON.stringify({ ...request, userDataPath })
    ],
    cwd: resolveAppRoot(),
    env: {
      ...stripElectronRunAsNode(process.env),
      OCC_BACKGROUND_LAUNCH: '1',
      OCC_USER_DATA_PATH: userDataPath
    },
    // Recovery may copy large backups; the lock owner must finish or be explicitly terminated.
    timeoutMs: null
  })
  const lines = response.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(PROFILE_STATE_RECOVERY_RESULT_PREFIX))
  if (!response.outputTruncated && lines.length === 1) {
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[0].slice(PROFILE_STATE_RECOVERY_RESULT_PREFIX.length))
    } catch {
      throw new RuntimeClientError(
        'runtime_error',
        'OCC recovery returned an invalid response. Inspect retained recovery artifacts before retrying.'
      )
    }
    const result = profileStateRecoveryResponseSchema.safeParse(parsed)
    if (result.success) {
      if (!result.data.ok) {
        throw new RuntimeClientError(result.data.code, result.data.message)
      }
      if (response.code === 0 && !response.signal && !response.timedOut) {
        return result.data.result
      }
    }
  }
  throw new RuntimeClientError(
    'runtime_error',
    'OCC recovery did not complete successfully. Inspect retained recovery artifacts before retrying.',
    {
      exitCode: response.code,
      signal: response.signal,
      timedOut: response.timedOut,
      outputTruncated: response.outputTruncated ?? false,
      stderr: response.stderr.trim().slice(-4096)
    }
  )
}
