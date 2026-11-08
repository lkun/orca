import { vi } from 'vitest'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { OCCRuntimeService } from '../../occ-runtime'
import { makeStore } from '../../rpc/server/runtime-rpc-worktree-store-fixtures'

export const AGENT_PROMPT_TEST_WORKTREE_PATH = '/tmp/worktree-a'
export const AGENT_PROMPT_TEST_WORKTREE_ID = 'repo-1::/tmp/worktree-a'

export async function createAgentPromptSubmissionRuntime(
  onWrite: (runtime: OCCRuntimeService, data: string, writeIndex: number) => void,
  launchAgent: TuiAgent = 'aider',
  write?: (runtime: OCCRuntimeService, ptyId: string, data: string) => boolean,
  runtimeDeps?: ConstructorParameters<typeof OCCRuntimeService>[2],
  controller?: Partial<NonNullable<Parameters<OCCRuntimeService['setPtyController']>[0]>>
): Promise<{ runtime: OCCRuntimeService; handle: string; writes: string[] }> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these runtimes read only the repo and worktree records makeStore models.
  const runtime = new OCCRuntimeService(makeStore() as never, undefined, runtimeDeps)
  const writes: string[] = []
  runtime.setPtyController({
    spawn: async () => ({ id: 'pty-prompt' }),
    write: (_ptyId, data) => {
      writes.push(data)
      onWrite(runtime, data, writes.length)
      return write?.(runtime, _ptyId, data) ?? true
    },
    kill: () => true,
    getForegroundProcess: async () => (write ? launchAgent : null),
    ...controller
  })
  const terminal = await runtime.createTerminal(`path:${AGENT_PROMPT_TEST_WORKTREE_PATH}`, {
    launchAgent
  })
  // Model a live foreground agent confirmed by its host.
  vi.spyOn(runtime, 'readLaunchedAgentForeground').mockResolvedValue('agent')
  return { runtime, handle: terminal.handle, writes }
}
