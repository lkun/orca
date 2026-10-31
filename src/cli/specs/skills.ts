import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SKILL_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['skills', 'installed'],
    summary: 'List installed skill selectors',
    usage: 'occ skills installed [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Lists discovery IDs and names without reading skill contents into the CLI.',
      'Package metadata is validated when the selected skills are shared.',
      'Use an exact ID or an unambiguous name with `occ skills share --skill <selector>`.'
    ]
  },
  {
    path: ['skills', 'share'],
    summary: 'Publish explicitly selected installed skills behind one unlisted link',
    usage:
      'occ skills share --skill <selector> [--skill <selector> ...] --bundle-name <name> ' +
      '[--release-notes <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill', 'bundle-name', 'release-notes'],
    notes: [
      'Requires the default-off permission in Settings → Share Skills.',
      'The bundle name may be human-readable; OCC converts it to a portable lowercase package name.',
      'Selectors are exact discovery IDs or unambiguous names from `occ skills installed`.',
      'Only discovered skill directories can be selected; arbitrary paths and --all are not supported.',
      'The resulting link is unlisted. Anyone with it can inspect and install the bundle.'
    ],
    examples: [
      'occ skills share --skill frontend --bundle-name "Frontend Skills"',
      'occ skills share --skill frontend --skill testing --bundle-name "Team Toolkit" --json'
    ]
  },
  {
    path: ['skills', 'list'],
    summary: 'List version-matched skill guides bundled with this OCC CLI',
    usage: 'occ skills list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Reads bundled guide metadata locally without contacting the OCC runtime.',
      'With --json, prints a topics array of canonical names and one-line descriptions.',
      'Use `occ skills get <name>` for the compact guide, `--full` for its full reference package, or `occ skills install` to install skills.'
    ]
  },
  {
    path: ['skills', 'get'],
    aliases: [['skills', 'show']],
    summary: 'Print a version-matched skill guide as Markdown',
    usage: 'occ skills get <topic> [--full | --reference <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'topic', 'full', 'reference', 'references'],
    positionalArgs: ['topic'],
    notes: [
      'Reads bundled guide content locally without contacting the OCC runtime.',
      'Prints the compact guide by default. Use --full to print the full guide with bundled references when provided.',
      'Use --reference <name> to print one bundled reference alone, which is what an action gate in the compact guide needs; --references lists the available names.',
      'A reference name may be given bare (recovery-and-cleanup) or as the guide spells it (references/recovery-and-cleanup.md).',
      'Use --json for a deterministic object containing canonical topic metadata and content.'
    ],
    examples: [
      'occ skills get orca-cli',
      'occ skills get orchestration --full',
      'occ skills get orchestration --references',
      'occ skills get orchestration --reference recovery-and-cleanup'
    ]
  },
  {
    path: ['skills', 'install'],
    summary: 'Install bundled OCC skills on this machine',
    usage:
      'occ skills install [--skill <name>]... [--all] [--agent <name>[,<name>]] ' +
      '[--local] [--force] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill', 'all', 'agent', 'local', 'force', 'dry-run'],
    notes: [
      'Reads the bundled skill registry locally without contacting the OCC runtime, ' +
        'and needs no network, Node, Git or npx.',
      'Writes the copy this OCC build ships into the shared .agents/skills folder and ' +
        'links it into each detected agent\u2019s skills folder, the same way the app\u2019s ' +
        'Update skills does.',
      'Only copies OCC wrote and nobody changed are updated. A copy you changed, or a ' +
        'different skill with the same name, is skipped and is reported; --force replaces ' +
        'it after moving it to a backup under ~/.agents/.orca-skill-backups.',
      'Installs globally (all projects) by default. Use --local to install into the ' +
        'current project; it links only into agent folders the project already has.',
      'Targets the coding agents OCC detects on this host. Use --agent <name>[,<name>...] ' +
        'to choose them yourself, or --agent universal for the shared folder alone.',
      'Use --dry-run to print what would change and the plan digest without writing; a ' +
        'real run plans again and writes only if the plan still matches.',
      'Exits 1 when a location failed or changed while it ran; skipped folders are warnings.',
      'Omit --skill and --all to list installable skill names.'
    ],
    examples: [
      'occ skills install --skill orca-cli --skill orchestration',
      'occ skills install --skill orca-cli --local',
      'occ skills install --skill orca-cli --agent claude,codex',
      'occ skills install --all --dry-run'
    ]
  },
  {
    path: ['skills', 'update'],
    summary: 'Update OCC skills to the version this OCC build ships',
    usage:
      'occ skills update [--skill <name>]... [--all] [--agent <name>[,<name>]] ' +
      '[--local] [--force] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill', 'all', 'agent', 'local', 'force', 'dry-run'],
    notes: [
      'Runs the same planner as `occ skills install`, but only at locations that already ' +
        'hold the skill; it never adds a skill, or an existing skill for another agent.',
      'Updates each untouched copy where it is; other copies are skipped unless you ' +
        'pass --force. Use `occ skills install` to add a skill for a newly detected agent.',
      'Updates the global install by default. Use --local to update the current project.',
      'Use --dry-run to print what would change and the plan digest without writing.',
      'With --json, both dry runs and real runs print the plan, and real runs the result.',
      'Omit --skill and --all to list updatable skill names.'
    ],
    examples: [
      'occ skills update --all',
      'occ skills update --skill orca-cli --dry-run',
      'occ skills update --all --force'
    ]
  }
]
