import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's OCC-managed Codex home before a shell launch",
    usage: 'occ agent hooks prepare-codex',
    allowedFlags: [...LOCAL_COMMAND_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether OCC-managed agent status hooks are enabled',
    usage: 'occ agent hooks status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['occ agent hooks status', 'occ agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable OCC-managed agent status hooks and remove local hook entries',
    usage: 'occ agent hooks off [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['occ agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable OCC-managed agent status hooks',
    usage: 'occ agent hooks on [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['occ agent hooks on']
  }
]
