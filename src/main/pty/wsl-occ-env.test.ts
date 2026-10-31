import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import { getShellReadyWrapperRoot } from '../providers/local-pty-shell-ready-wrapper-root'
import {
  SETUP_AGENT_SEQUENCE_SETUP_SCRIPT_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import { addOCCWslInteropEnv, stampWslOrchestrationCompatibilityHost } from './wsl-occ-env'
import { CODEX_REMOTE_VIEWER_SSH_CONNECTION } from '../ipc/pty/host-env/remote-viewer-clipboard-env'

describe('addOCCWslInteropEnv', () => {
  it.each(['1', '0'])(
    'forwards Claude image override %s to WSL without path translation',
    (value) => {
      const env: Record<string, string> = { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: value }

      addOCCWslInteropEnv(env)
      addOCCWslInteropEnv(env)

      expect(env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES).toBe(value)
      expect(
        env.WSLENV.split(':').filter((entry) =>
          entry.startsWith('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')
        )
      ).toEqual(['CLAUDE_CODE_FORCE_TERMINAL_IMAGES/u'])
    }
  )

  it('marks the OCC terminal handle for Windows to WSL env import', () => {
    const env: Record<string, string> = { OCC_TERMINAL_HANDLE: 'term_wsl' }

    addOCCWslInteropEnv(env)

    expect(env.WSLENV).toBe('OCC_TERMINAL_HANDLE/u:OCC_SHELL_READY_ROOT/p')
  })

  // Guests cannot derive the wrapper content hash from userData; publish the resolved root to avoid unwrapped launches.
  it('publishes the resolved wrapper root path-translated for the guest', () => {
    const env: Record<string, string> = {}

    addOCCWslInteropEnv(env)

    expect(env.OCC_SHELL_READY_ROOT).toBe(getShellReadyWrapperRoot())
    expect(isAbsolute(env.OCC_SHELL_READY_ROOT as string)).toBe(true)
    // Translate the host wrapper path for guest access.
    expect(env.WSLENV?.split(':')).toContain('OCC_SHELL_READY_ROOT/p')
  })

  it('imports setup-gated startup and setup env into WSL without path translation', () => {
    const env: Record<string, string> = {
      [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: 'codex',
      [SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV]: 'while :; do sleep 1; done',
      [SETUP_AGENT_SEQUENCE_SETUP_SCRIPT_ENV]: '( bash /repo/setup-runner.sh )'
    }

    addOCCWslInteropEnv(env)

    expect(env.WSLENV?.split(':')).toEqual([
      'OCC_SHELL_READY_ROOT/p',
      `${SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV}/u`,
      `${SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV}/u`,
      `${SETUP_AGENT_SEQUENCE_SETUP_SCRIPT_ENV}/u`
    ])
  })

  it('preserves existing WSLENV entries and does not duplicate the handle entry', () => {
    const env: Record<string, string> = {
      WSLENV: 'FOO/u:OCC_TERMINAL_HANDLE/u:BAR/p'
    }

    addOCCWslInteropEnv(env)

    expect(env.WSLENV).toBe('FOO/u:OCC_TERMINAL_HANDLE/u:BAR/p:OCC_SHELL_READY_ROOT/p')
  })

  it('marks OMP status and hook env for Windows to WSL import', () => {
    const env: Record<string, string> = {
      OCC_TERMINAL_HANDLE: 'term_wsl',
      OCC_USER_DATA_PATH: 'C:\\Users\\jin\\AppData\\Roaming\\OCC',
      OCC_CLI_COMMAND: 'occ-ide',
      OCC_WSL_CLI_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\OCC\\wsl-managed-cli\\hash',
      OCC_CODEX_LAUNCH_PREFLIGHT: 'C:\\Program Files\\OCC\\resources\\bin\\occ.exe',
      OCC_CODEX_ISOLATE: '0',
      OCC_OMP_FRESH_CONFIG: 'C:\\OCC\\fresh-session.yml',
      OCC_OMP_STATUS_EXTENSION: 'C:\\Users\\jin\\.omp\\agent\\extensions\\occ-agent-status.ts',
      OCC_PRIME_AGENT_STATUS_EXTENSION: 'C:\\stale\\occ-agent-status.ts',
      OCC_PANE_KEY: 'tab-1:leaf-1',
      OCC_AGENT_PANE: 'tab-1:leaf-1',
      OCC_TAB_ID: 'tab-1',
      OCC_WORKTREE_ID: 'repo::\\\\wsl.localhost\\Ubuntu\\home\\jin\\repo',
      OCC_AGENT_LAUNCH_TOKEN: 'launch-secret',
      OCC_AGENT_LAUNCH: 'launch-secret',
      OCC_OPENCODE_AGENT: 'opencode2',
      OCC_AGENT_HOOK_PORT: '4567',
      OCC_AGENT_HOOK_TOKEN: 'token',
      OCC_AGENT_HOOK_ENV: 'dev',
      OCC_AGENT_HOOK_VERSION: '1',
      OCC_AGENT_HOOK_TRANSPORT: 'raw-json-v1',
      OCC_WSL_HOOK_INSTANCE: 'testinstance',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu',
      OCC_RUNTIME_SOURCE_ID: '11111111-1111-4111-8111-111111111111',
      OCC_RUNTIME_SOURCE_INCARNATION: 'runtime-a',
      OCC_RUNTIME_SOURCE_PROFILE_PATH: 'C:\\Users\\a\\AppData\\Roaming\\occ'
    }

    addOCCWslInteropEnv(env)

    expect(env.WSLENV).toContain('OCC_TERMINAL_HANDLE/u')
    expect(env.WSLENV).toContain('OCC_USER_DATA_PATH/p')
    expect(env.WSLENV).toContain('OCC_CLI_COMMAND/u')
    expect(env.WSLENV).toContain('OCC_WSL_CLI_DIR/p')
    expect(env.WSLENV).toContain('OCC_CODEX_LAUNCH_PREFLIGHT/p')
    expect(env.WSLENV).toContain('OCC_CODEX_ISOLATE/u')
    expect(env.WSLENV).toContain('OCC_OMP_STATUS_EXTENSION/p')
    expect(env.WSLENV).toContain('OCC_OMP_FRESH_CONFIG/p')
    expect(env.WSLENV).not.toContain('OCC_PRIME_AGENT_STATUS_EXTENSION')
    expect(env.WSLENV).toContain('OCC_PANE_KEY/u')
    expect(env.WSLENV).toContain('OCC_AGENT_PANE/u')
    expect(env.WSLENV).toContain('OCC_TAB_ID/u')
    expect(env.WSLENV).toContain('OCC_WORKTREE_ID/u')
    expect(env.WSLENV).toContain('OCC_AGENT_LAUNCH_TOKEN/u')
    expect(env.WSLENV).toContain('OCC_AGENT_LAUNCH/u')
    expect(env.WSLENV).toContain('OCC_OPENCODE_AGENT/u')
    expect(env.WSLENV).toContain('OCC_AGENT_HOOK_PORT/u')
    expect(env.WSLENV).toContain('OCC_AGENT_HOOK_TOKEN/u')
    expect(env.WSLENV).toContain('OCC_AGENT_HOOK_ENV/u')
    expect(env.WSLENV).toContain('OCC_AGENT_HOOK_VERSION/u')
    expect(env.WSLENV).toContain('OCC_AGENT_HOOK_TRANSPORT/u')
    expect(env.WSLENV).toContain('OCC_WSL_HOOK_INSTANCE/u')
    expect(env.WSLENV).toContain('OCC_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u')
    expect(env.WSLENV).toContain('OCC_ORCHESTRATION_COMPATIBILITY_HOST_ID/u')
    expect(env.WSLENV).toContain('OCC_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u')
    expect(env.WSLENV).toContain('OCC_RUNTIME_SOURCE_ID/u')
    expect(env.WSLENV).toContain('OCC_RUNTIME_SOURCE_INCARNATION/u')
    expect(env.WSLENV).toContain('OCC_RUNTIME_SOURCE_PROFILE_PATH/u')
  })

  it('overwrites caller host evidence with native runtime WSL authority', () => {
    const env = {
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      OCC_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', 'Ubuntu')

    expect(env).toEqual({
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu'
    })
  })

  it('clears inherited host evidence outside a runtime-owned WSL scope', () => {
    const env = {
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      OCC_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      OCC_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', null)

    expect(env).toEqual({})
  })

  it('path-translates a Windows hook endpoint but passes a guest-side one untouched', () => {
    const windowsEnv: Record<string, string> = {
      OCC_AGENT_HOOK_ENDPOINT: 'C:\\Users\\jin\\AppData\\Roaming\\OCC\\agent-hooks\\endpoint.cmd'
    }
    addOCCWslInteropEnv(windowsEnv)
    expect(windowsEnv.WSLENV).toContain('OCC_AGENT_HOOK_ENDPOINT/p')

    const guestEnv: Record<string, string> = {
      OCC_AGENT_HOOK_ENDPOINT: '/home/jin/.occ-wsl/agent-hooks/port-4567/endpoint.env'
    }
    addOCCWslInteropEnv(guestEnv)
    expect(guestEnv.WSLENV).toContain('OCC_AGENT_HOOK_ENDPOINT/u')
    expect(guestEnv.WSLENV).not.toContain('OCC_AGENT_HOOK_ENDPOINT/p')
  })

  it('tags pre-translated Linux setup paths /u so WSLENV does not translate them again (#9206)', () => {
    const env: Record<string, string> = {
      OCC_ROOT_PATH: '/home/jin/repo',
      OCC_WORKTREE_PATH: '/home/jin/repo-worktrees/fix-1',
      OCC_WORKSPACE_NAME: 'fix-1',
      CONDUCTOR_ROOT_PATH: '/home/jin/repo',
      GHOSTX_ROOT_PATH: '/home/jin/repo'
    }

    addOCCWslInteropEnv(env)

    // Already-Linux hook paths must cross untranslated to avoid a second conversion.
    expect(env.WSLENV).toContain('OCC_ROOT_PATH/u')
    expect(env.WSLENV).toContain('OCC_WORKTREE_PATH/u')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/u')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('OCC_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('OCC_WORKTREE_PATH/p')
    expect(env.OCC_ROOT_PATH).toBe('/home/jin/repo')
    expect(env.OCC_WORKTREE_PATH).toBe('/home/jin/repo-worktrees/fix-1')
  })

  it('tags untranslated Windows setup paths /p so WSLENV translates them (wsl.exe shell over a Windows worktree)', () => {
    const env: Record<string, string> = {
      OCC_ROOT_PATH: 'C:\\Users\\jin\\repo',
      OCC_WORKTREE_PATH: 'C:\\Users\\jin\\repo-worktrees\\fix-1',
      CONDUCTOR_ROOT_PATH: 'C:\\Users\\jin\\repo',
      GHOSTX_ROOT_PATH: 'C:\\Users\\jin\\repo'
    }

    addOCCWslInteropEnv(env)

    expect(env.WSLENV).toContain('OCC_ROOT_PATH/p')
    expect(env.WSLENV).toContain('OCC_WORKTREE_PATH/p')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/p')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('OCC_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('OCC_WORKTREE_PATH/u')
  })

  it('always tags OCC_WORKSPACE_NAME /u because it is a name, not a path', () => {
    const env: Record<string, string> = { OCC_WORKSPACE_NAME: 'fix-1' }

    addOCCWslInteropEnv(env)

    expect(env.WSLENV).toBe('OCC_SHELL_READY_ROOT/p:OCC_WORKSPACE_NAME/u')
  })

  it.each(['repo::\\\\wsl.localhost\\Ubuntu\\home\\jin\\repo', 'folder:f1'])(
    'crosses the workspace id %s into the guest untranslated (/u), as the window and main stamp it',
    (workspaceId) => {
      const env: Record<string, string> = { OCC_WORKSPACE_ID: workspaceId }

      addOCCWslInteropEnv(env)

      expect(env.OCC_WORKSPACE_ID).toBe(workspaceId)
      expect(env.WSLENV?.split(':')).toContain('OCC_WORKSPACE_ID/u')
    }
  )

  // #10861: wsl.exe drops SSH_CONNECTION, so WSL Codex copied only to the Windows clipboard.
  it('crosses the Codex remote-viewer clipboard marker into the guest untranslated (/u)', () => {
    const env: Record<string, string> = {
      SSH_CONNECTION: CODEX_REMOTE_VIEWER_SSH_CONNECTION,
      OCC_REMOTE_VIEWER_CLIPBOARD: '1'
    }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV?.split(':')).toContain('SSH_CONNECTION/u')
    expect(env.WSLENV?.split(':')).toContain('OCC_REMOTE_VIEWER_CLIPBOARD/u')
  })

  it("leaves the Windows host's own SSH session out of the guest", () => {
    const env: Record<string, string> = { SSH_CONNECTION: '10.0.0.1 5000 10.0.0.2 22' }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV?.split(':')).not.toContain('SSH_CONNECTION/u')
  })

  it('crosses the inline-image protocol hint into the guest untranslated (/u)', () => {
    const env: Record<string, string> = { OCC_IMAGE_PROTOCOL: 'kitty' }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV).toContain('OCC_IMAGE_PROTOCOL/u')
  })

  it('marks the WSL hook relay version for import on relay spawn envs', () => {
    const env: Record<string, string> = {
      OCC_WSL_HOOK_RELAY_VERSION: '0.1.0+abc'
    }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV).toBe('OCC_SHELL_READY_ROOT/p:OCC_WSL_HOOK_RELAY_VERSION/u')
  })

  it('crosses a guest-side OpenCode config overlay untranslated (/u)', () => {
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: '/home/jin/.occ-relay/opencode-overlays/abc',
      OCC_OPENCODE_CONFIG_DIR: '/home/jin/.occ-relay/opencode-overlays/abc'
    }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV).toContain('OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).toContain('OCC_OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR/p')
  })

  it('never crosses a Windows OpenCode config dir into the guest', () => {
    // Windows overlays can leak through inherited relay/daemon env; never translate them into guest OpenCode config roots.
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\OCC\\opencode-overlays\\abc',
      OCC_OPENCODE_CONFIG_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\OCC\\opencode-overlays\\abc'
    }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('OCC_OPENCODE_CONFIG_DIR')
  })

  it('does not register the OpenCode config vars when they are absent', () => {
    const env: Record<string, string> = { OCC_TERMINAL_HANDLE: 'term_wsl' }
    addOCCWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('OCC_OPENCODE_CONFIG_DIR')
  })
})
