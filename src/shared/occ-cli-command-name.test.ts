import { describe, expect, it } from 'vitest'
import { installFakeAppEnvironment } from '../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './agent-launch/catalog/tui-agent-config'

const agentTeams = TUI_AGENT_CONFIG['claude-agent-teams']

describe('Claude Agent Teams launch name on the launching host', () => {
  it('uses plain occ on a headless Linux server, whose PATH has no occ-ide (#33920)', () => {
    installFakeAppEnvironment({ getCliLauncherPath: () => '/home/u/.occ/cli/bin/occ' })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('occ claude-teams')
  })

  it('keeps the occ-ide rename for WSL under a Windows server', () => {
    installFakeAppEnvironment({
      getCliLauncherPath: () => 'C:\\Users\\u\\.occ\\cli\\bin\\occ.exe'
    })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('occ-ide claude-teams')
  })
})
