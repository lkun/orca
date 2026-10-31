import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'occ' | 'occ-ide' | 'occ-dev' {
  const configured = process.env.OCC_CLI_COMMAND
  if (configured === 'occ' || configured === 'occ-ide' || configured === 'occ-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'occ-ide' : 'occ'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'occ' | 'occ-ide' | undefined {
  if (process.env.OCC_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.OCC_CLI_COMMAND
  if (command === 'occ' || command === 'occ-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged OCC launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.OCC_DEV_CLI_INVOCATION === '1' ||
    (process.env.OCC_USER_DATA_PATH?.includes('occ-dev') ?? false)
  )
}
