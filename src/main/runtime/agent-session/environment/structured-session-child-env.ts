/** Name children by stable OCC session id; provider ids rotate on clear. Reject cross-host claims; retain worker handles for non-orchestration surfaces.
 * Pin the CLI by absolute launcher and user-data path because login shells can reorder PATH; older CLIs refuse the structured marker.
 * Reuse the PTY CLI-path rule: Linux installs as occ-ide to avoid GNOME OCC (#7904). Never fall back to bare or inherited launchers.
 * Empty remote selectors to mask the parent env; explicit flags still work, and login profiles can re-export selectors.
 * Omit pane identity: hooks and mobile status assume a live PTY leaf. Resolve worker identity at every spawn, including recovery and clear. */

import { getAppEnvironment, hasAppEnvironment } from '../../../../shared/app-environment'
import {
  OCC_AGENT_SESSION_ID_ENV,
  OCC_AGENT_SESSION_SPAWN_TOKEN_ENV
} from '../../../../shared/agent-session/lifecycle/agent-session-caller-env'
import {
  OCC_SCRUB_SAFE_LAUNCH_ENV,
  OCC_SCRUB_SAFE_PANE_ENV
} from '../../../../shared/agent-hook-listener/transport/agent-hook-scrub-safe-env'
import { OCC_STRUCTURED_SESSION_ENV } from '../../../../shared/structured-session-marker'
import { withCliRuntimeOnPath } from '../../../../shared/node-cli-command-resolution'
import { prependOCCCliDirToChildPath } from '../../../cli/occ-cli-child-path'
import { AGENT_HOOK_RUNTIME_ENV_KEYS } from '../../../ipc/pty/host-env/spawn-env-keys'
import { resolveStructuredWorkerIdentityForSession } from '../../orchestration/terminal-authority/structured-sessions/structured-worker-authority'

/** Remove inherited pane identity so hook status cannot compete with the structured-session producer. */
export const STRUCTURED_CHILD_ENV_TO_DELETE: readonly string[] = [
  'OCC_PANE_KEY',
  'OCC_TAB_ID',
  'OCC_WORKTREE_ID',
  'OCC_AGENT_LAUNCH_TOKEN',
  OCC_SCRUB_SAFE_PANE_ENV,
  OCC_SCRUB_SAFE_LAUNCH_ENV,
  ...AGENT_HOOK_RUNTIME_ENV_KEYS
]

export type SealedStructuredSessionChild = {
  env: Record<string, string>
  /** Removed from what the child inherits, after `env` is laid over it. */
  envToDelete: string[]
  /** Reapply session identity when agents rebuild command env. Exclude the child-only spawn token and PATH, which would freeze login-shell restoration; Codex core already inherits PATH. */
  commandEnv: Record<string, string>
}

/** Every agent declares inherited keys to strip; sealed identity keys survive. Put cliRuntimeCommand's directory behind this app's CLI so the Node launcher finds its runtime. */
export function sealStructuredSessionChild(input: {
  sessionId: string
  spawnToken: string
  env: Record<string, string>
  inheritedEnvToDelete: readonly string[]
  cliRuntimeCommand?: string
}): SealedStructuredSessionChild {
  // Why: pair before naming the child so this app's CLI dir stays ahead of a runtime dir holding another `occ`.
  const paired = input.cliRuntimeCommand
    ? withCliRuntimeOnPath(input.cliRuntimeCommand, input.env, { platform: process.platform })
    : input.env
  const identity = childIdentity(input.sessionId, paired)
  const named = new Set([...Object.keys(identity.commandEnv), OCC_AGENT_SESSION_SPAWN_TOKEN_ENV])
  return {
    env: { ...identity.env, [OCC_AGENT_SESSION_SPAWN_TOKEN_ENV]: input.spawnToken },
    envToDelete: input.inheritedEnvToDelete.filter((key) => !named.has(key)),
    commandEnv: identity.commandEnv
  }
}

function childIdentity(
  sessionId: string,
  childEnv: Record<string, string>
): { env: Record<string, string>; commandEnv: Record<string, string> } {
  const identity = resolveStructuredWorkerIdentityForSession(sessionId, null)
  const named: Record<string, string> = {
    ...(identity ? { OCC_TERMINAL_HANDLE: identity.handle } : {}),
    [OCC_AGENT_SESSION_ID_ENV]: sessionId,
    [OCC_STRUCTURED_SESSION_ENV]: '1'
  }
  const env = { ...childEnv, ...named }
  return { env, commandEnv: { ...named, ...applyThisAppCli(env) } }
}

const REMOTE_RUNTIME_SELECTOR_ENV_KEYS = [
  'OCC_ENVIRONMENT',
  'OCC_PAIRING_CODE',
  'OCC_REMOTE_PAIRING'
] as const

/** Without an installed app environment, no user-data root is known; inventing one would write the CLI shim into the wrong directory. */
function applyThisAppCli(env: Record<string, string>): Record<string, string> {
  delete env.OCC_CLI_COMMAND
  if (!hasAppEnvironment()) {
    return {}
  }
  const app = getAppEnvironment()
  const userDataPath = app.getPath('userData')
  const isPackaged = app.isPackaged()
  const set: Record<string, string> = { OCC_USER_DATA_PATH: userDataPath }
  for (const key of REMOTE_RUNTIME_SELECTOR_ENV_KEYS) {
    set[key] = ''
  }
  Object.assign(env, set)
  const launcher = prependOCCCliDirToChildPath(env, {
    isPackaged,
    userDataPath,
    resourcesPath: process.resourcesPath ?? null
  })
  if (launcher) {
    set.OCC_CLI_COMMAND = launcher
    env.OCC_CLI_COMMAND = launcher
  } else {
    console.warn(
      "[structured-session] This app's CLI launcher did not resolve; the session's child has no OCC_CLI_COMMAND."
    )
  }
  return set
}
