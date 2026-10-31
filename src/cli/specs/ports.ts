import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports OCC detected for a workspace',
    usage: 'occ ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the OCC workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports OCC tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes OCC could not tie to one. A native folder workspace needs --all, because OCC does not tie ports to folders.',
      'url is the address the dev server printed in an OCC terminal; it is missing when OCC did not see one.'
    ],
    examples: [
      'occ ports',
      'occ ports --worktree branch:feature/login --json',
      'occ ports --all',
      "occ ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]
