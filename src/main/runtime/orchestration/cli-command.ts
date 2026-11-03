import type { RuntimePtyWorktreeRecord } from '../runtime-terminal-state-records'
import { isStructuredWorkerHandle } from '../../../shared/structured-worker-handle'
import { parseOCCSessionAddress } from '../../../shared/occ-session-address'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-environment'

export type OrchestrationCliCommand = 'occ' | 'occ-dev' | 'occ-ide'

/** Dev builds run the CLI as `occ-dev`; a packaged app, or a process with no app, must not advertise it. */
export function runtimeOrchestrationCliCommand(): OrchestrationCliCommand | undefined {
  return hasAppEnvironment() && !getAppEnvironment().isPackaged() ? 'occ-dev' : undefined
}

/** What a local, non-WSL terminal is told to run; a structured session is always one. */
export function localOrchestrationCliCommand(): OrchestrationCliCommand {
  return runtimeOrchestrationCliCommand() ?? 'occ'
}

export function resolveTerminalOrchestrationCliCommand(args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  projectRuntime?: ProjectExecutionRuntimeResolution
  runtimeCliCommand?: OrchestrationCliCommand
}): OrchestrationCliCommand {
  if (args.connectionId) {
    return 'occ'
  }
  if (args.runtimeCliCommand) {
    return args.runtimeCliCommand
  }
  if (args.isWsl !== null && args.isWsl !== undefined) {
    return args.isWsl ? 'occ-ide' : 'occ'
  }
  if (args.projectRuntime?.status === 'resolved' && args.projectRuntime.runtime.kind === 'wsl') {
    return 'occ-ide'
  }

  const worktreePath = splitWorktreeIdForFilesystem(args.worktreeId)?.worktreePath
  return worktreePath && isWslUncPath(worktreePath) ? 'occ-ide' : 'occ'
}

export function resolveRuntimeTerminalOrchestrationCliCommand(
  handle: string,
  source: {
    resolvePtyId: (handle: string) => string | null | undefined
    getPty: (ptyId: string) => RuntimePtyWorktreeRecord | undefined
    getProjectRuntime: (
      pty: RuntimePtyWorktreeRecord
    ) => ProjectExecutionRuntimeResolution | undefined
  }
): OrchestrationCliCommand {
  // A structured session runs in this process: it is told what the structured mail lane types.
  if (isStructuredWorkerHandle(handle) || parseOCCSessionAddress(handle)) {
    return localOrchestrationCliCommand()
  }
  let pty: RuntimePtyWorktreeRecord | null = null
  try {
    const ptyId = source.resolvePtyId(handle)
    pty = ptyId ? (source.getPty(ptyId) ?? null) : null
  } catch {
    return 'occ'
  }
  if (!pty) {
    return 'occ'
  }
  return resolveTerminalOrchestrationCliCommand({
    connectionId: pty.connectionId,
    isWsl: pty.isWsl,
    worktreeId: pty.worktreeId,
    runtimeCliCommand: runtimeOrchestrationCliCommand(),
    projectRuntime: source.getProjectRuntime(pty)
  })
}
