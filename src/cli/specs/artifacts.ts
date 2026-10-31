import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

const CLOUD_FLAGS = ['api-url']

export const ARTIFACT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['artifacts', 'share'],
    summary: 'Share an HTML or Markdown file with your OCC account',
    usage: 'occ artifacts share <file> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'file'],
    positionalArgs: ['file'],
    examples: ['occ artifacts share ./report.html', 'occ artifacts share ./notes.md --json']
  },
  {
    path: ['artifacts', 'update'],
    summary: 'Update a file previously shared from this OCC profile',
    usage: 'occ artifacts update <file> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'file'],
    positionalArgs: ['file']
  },
  {
    path: ['artifacts', 'unshare'],
    destructive: true,
    summary: 'Delete the artifact associated with a previously shared file',
    usage: 'occ artifacts unshare <file> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'file'],
    positionalArgs: ['file']
  },
  {
    path: ['artifacts', 'list'],
    summary: 'List artifacts owned by the signed-in OCC account',
    usage: 'occ artifacts list [--cursor <cursor>] [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'cursor']
  },
  {
    path: ['artifacts', 'delete'],
    aliases: [['artifacts', 'rm']],
    destructive: true,
    summary: 'Delete an artifact owned by the signed-in OCC account',
    usage: 'occ artifacts delete <id> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'id'],
    positionalArgs: ['id']
  }
]
