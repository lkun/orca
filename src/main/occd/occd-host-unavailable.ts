// Remember repeatable deployment refusals per app version; host-fixable settings must be reprobed.

export class OCCdHostUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OCCdHostUnsupportedError'
  }
}

export class OCCdArtifactsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OCCdArtifactsUnavailableError'
  }
}

export class OCCdStdioBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OCCdStdioBridgeUnavailableError'
  }
}

export const OCCD_TUNNEL_UNAVAILABLE_REASON = 'ssh_tunnel_unavailable'
export const OCCD_WINDOWS_LAUNCH_REFUSED_CODE = 'occd_windows_launch_refused'
export const OCCD_WINDOWS_COMMAND_LINE_UNSAFE_CODE = 'occd_windows_command_line_unsafe'

export type OCCdHostUnavailableReason =
  | 'unsupported_host'
  | 'artifacts_unavailable'
  | 'libc_unidentified'
  | 'runtime_self_test'
  | 'runtime_noexec'
  | 'windows_build_unsupported'
  | 'windows_no_extractor'
  | 'security_software'
  | 'native_preflight'
  | typeof OCCD_TUNNEL_UNAVAILABLE_REASON

const UNAVAILABLE_BY_ERROR_NAME: Record<string, OCCdHostUnavailableReason> = {
  OCCdHostUnsupportedError: 'unsupported_host',
  OCCdArtifactsUnavailableError: 'artifacts_unavailable',
  OCCdRemoteLaunchUnsupportedError: 'unsupported_host',
  UnidentifiedHostLibcError: 'libc_unidentified',
  RemoteNodeRuntimeSelfTestError: 'runtime_self_test',
  RemoteNodeRuntimeNoexecError: 'runtime_noexec',
  RemoteWindowsBuildUnsupportedError: 'windows_build_unsupported',
  RemoteNodeRuntimeNoExtractorError: 'windows_no_extractor',
  RemoteNodeRuntimeSecurityModifiedError: 'security_software',
  OCCdStdioBridgeUnavailableError: OCCD_TUNNEL_UNAVAILABLE_REASON,
  OCCdWindowsLaunchRefusedError: 'unsupported_host',
  OCCdWindowsCommandLineError: 'unsupported_host'
}

// Native preflight, PTY self-test and permanent Windows refusals repeat; transient races do not.
const UNAVAILABLE_BY_DEFERRAL_CODE: Record<string, OCCdHostUnavailableReason> = {
  occd_candidate_preflight_failed: 'native_preflight',
  occd_activation_pty_self_test_failed: 'native_preflight',
  [OCCD_WINDOWS_LAUNCH_REFUSED_CODE]: 'unsupported_host',
  [OCCD_WINDOWS_COMMAND_LINE_UNSAFE_CODE]: 'unsupported_host'
}

// Reprobed on every connect, so fixing or upgrading the host needs no new OCC version.
const FIXABLE_ON_HOST: ReadonlySet<string> = new Set<OCCdHostUnavailableReason>([
  'runtime_noexec',
  'windows_build_unsupported',
  'windows_no_extractor'
])

export function isOCCdHostUnavailableFixableOnHost(reason: string): boolean {
  return FIXABLE_ON_HOST.has(reason)
}

export function occdCandidateLaunchFailureCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === OCCD_WINDOWS_LAUNCH_REFUSED_CODE ||
    code === OCCD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
    ? code
    : 'occd_candidate_launch_failed'
}

export function classifyOCCdHostUnavailable(failure: unknown): OCCdHostUnavailableReason | null {
  if (failure instanceof Error) {
    return UNAVAILABLE_BY_ERROR_NAME[failure.name] ?? null
  }
  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = failure.code
    return typeof code === 'string' ? (UNAVAILABLE_BY_DEFERRAL_CODE[code] ?? null) : null
  }
  return null
}
