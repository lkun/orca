import { buildWindowsAgentHookPostCommand } from '../agent-hooks/installer-utils'
import { buildWindowsHookEnvironmentGuardLines } from '../agent-hooks/hook-stdin-contract'

/** Matches the envelope length cap used by the POSIX grok-hook branch. */
export const GROK_HOME_ENVELOPE_MAX_LENGTH = 4096

const WINDOWS_GROK_HOOK_POST_COMMAND = buildWindowsAgentHookPostCommand('grok', [
  '  --data-urlencode "grokHome=%OCC_GROK_HOME%" ^'
])

/** Guard cmd substring operations with goto when GROK_HOME is unset; bound length and strip quotes before expansion. */
export function buildWindowsGrokHookScript(): string {
  return [
    '@echo off',
    // Inherited delayed expansion would consume literal ! characters in Windows paths and pane identity.
    'setlocal DisableDelayedExpansion',
    'if defined OCC_AGENT_HOOK_ENDPOINT if exist "%OCC_AGENT_HOOK_ENDPOINT%" call "%OCC_AGENT_HOOK_ENDPOINT%" 2>nul',
    ...buildWindowsHookEnvironmentGuardLines(),
    'set "OCC_GROK_HOME="',
    'if not defined GROK_HOME goto :occ_grok_home_ready',
    `if not "%GROK_HOME:~${GROK_HOME_ENVELOPE_MAX_LENGTH},1%"=="" goto :occ_grok_home_ready`,
    // setx can store a trailing quote, which is illegal in paths and breaks cmd parsing; strip it first.
    'set "OCC_GROK_HOME=%GROK_HOME:"=%"',
    'if not defined OCC_GROK_HOME goto :occ_grok_home_ready',
    'if "%OCC_GROK_HOME:~-1%"=="\\" set "OCC_GROK_HOME=%OCC_GROK_HOME%."',
    // Leave room for the trailing-backslash sentinel in the relay envelope.
    `if not "%OCC_GROK_HOME:~${GROK_HOME_ENVELOPE_MAX_LENGTH},1%"=="" set "OCC_GROK_HOME="`,
    ':occ_grok_home_ready',
    WINDOWS_GROK_HOOK_POST_COMMAND,
    'exit /b 0',
    ''
  ].join('\r\n')
}
