import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const SERVE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['serve'],
    summary: 'Start an OCC runtime server without opening a desktop window',
    usage:
      'occ serve [--port <port>] [--bind <ip>] [--pairing-address <host>] [--allow-public | --refuse-public] [--mobile-pairing] [--no-pairing] [--grant-desktop-control] [--project-root <path>] [--recipe-json] [--supervise] [--force] [--reclaim-stale-lock [--data-root <dir>] [--yes]] [--json]',
    allowedFlags: [
      ...LOCAL_COMMAND_FLAGS,
      'port',
      'bind',
      'pairing-address',
      'allow-public',
      'refuse-public',
      'mobile-pairing',
      'no-pairing',
      'grant-desktop-control',
      'project-root',
      'recipe-json',
      'supervise',
      'force',
      'reclaim-stale-lock',
      'data-root',
      'yes'
    ],
    notes: [
      'Runs in the foreground and prints the bound endpoint, advertised endpoint, and pairing status. Stop it with Ctrl+C.',
      'With --port, serve exits with an error when that port is already in use. Without it, serve uses 6768 and moves to another port when 6768 is taken.',
      '--pairing-address changes only the client-advertised address; use a reachable LAN, Tailscale, SSH-forward, or reverse-proxy endpoint.',
      '--bind controls the interface the runtime listens on; it accepts a literal IP such as 127.0.0.1, a Tailscale address, or 0.0.0.0. --mobile-pairing needs no --bind or --bind 0.0.0.0.',
      'Serve accepts clients from localhost, LAN (10/8, 172.16/12, 192.168/16, link-local, fc00::/7) and Tailscale (100.64/10, fd7a:115c:a1e0::/48) addresses. Public addresses are also accepted with --allow-public, when --pairing-address is a hostname or public IP, once a paired device has connected from one, or while devices paired before this check existed remain paired. Addresses inside a network prefix of one of this host interfaces (for example same-network global IPv6) count as LAN. --refuse-public refuses public addresses in every case and cannot be combined with --allow-public. The startup log states which applies.',
      'Use --recipe-json with --project-root from VM recipes to print the recipe result JSON and leave the server running.',
      'Use --mobile-pairing to print a mobile-scoped pairing QR/link instead of the default runtime-environment pairing link. To pair later without restarting, run `occ pair`.',
      'On a packaged macOS app serve runs Electron, which needs a desktop login; over SSH with nobody logged in, set OCC_SERVE_RUNTIME=occd to run the Node server instead (it has no in-app updater).',
      "A paired client cannot drive this machine's desktop (occ computer) unless the offer was created with --grant-desktop-control.",
      'When the web client bundle is available, the server also prints a browser URL with the pairing data embedded.',
      'Exits with code 3, without starting anything, when another OCC already serves this profile or cannot be shown to have stopped.',
      "--reclaim-stale-lock starts nothing. When a start refuses because this profile's lock may belong to an OCC on another machine sharing this home (for example after a reboot, on a network home), it checks that the lock was written on a host with this name in an earlier boot, was last written or refreshed at least 5 minutes ago, and that nothing answers on this machine at its holder's endpoints. Those checks cannot rule out another machine with the same host name, so it then only prints what it found (exit 2); add --yes, once you are sure no other machine sharing this home runs OCC for this profile, to clear it (exit 0). It exits 1 when a check fails and 4 when there is no lock. --data-root names the data root the refusal printed. --json prints the status (none, eligible, refused or reclaimed). Linux only.",
      'On macOS, after OCC serve aborts at startup (it could not register with Launch Services), later runs from the same environment refuse for 30 minutes with exit code 78. Use --force to try anyway.',
      '--supervise is for service managers (launchd, systemd). OCC serve then restarts the server itself with growing delays instead of exiting when it stops, waits while an update replaces the app, and waits while another OCC serves this profile. On the occd runtime (the default), a supervised server does not start without its terminal daemon, because terminals outside it would not survive a restart; that counts as a failure. After 6 failures in 15 minutes it gives up and exits with code 0 so the manager stops too, and later supervised runs refuse until a new build is installed or --force is passed. Not available on Windows yet.',
      'Experimental and off by default: set OCC_TERMINAL_PROCESS_CEILING=<n> (64 or more) before the terminal host starts to have the OS cap how many processes each terminal may run (Linux, through a systemd user scope per terminal, which needs a user manager that outlives logout; Windows, through a job per terminal). `occ serve` reports the ceiling as on or off, with the reason.',
      'Off by default: set OCC_TERMINAL_MEMORY_MAX=<size> (256M or more) and OCC_TERMINAL_MEMORY_SWAP_MAX=<size> (0 for no swap) before the terminal host starts to cap the memory and swap of each terminal on Linux, through the same per-terminal systemd user scope. A terminal over its limit has its largest process OOM-killed; the host and other terminals keep running. Sizes take K, M, G or T. A limit the host cannot enforce is skipped and logged in the terminal host log. No effect on macOS or Windows.'
    ],
    examples: [
      'occ serve',
      'occ serve --json',
      'occ serve --project-root /workspace/repo --pairing-address wss://sandbox.example.com --recipe-json',
      'occ serve --port 6768 --bind 100.64.1.20 --pairing-address 100.64.1.20',
      'occ serve --pairing-address 100.64.1.20 --mobile-pairing',
      'occ serve --reclaim-stale-lock'
    ]
  },
  {
    path: ['serve', 'restore', 'resume'],
    summary: 'Resume automatic terminal restores that this host paused',
    usage: 'occ serve restore resume [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'After its terminal host stops unexpectedly, or while it is overloaded, OCC keeps restored agent sessions asleep instead of starting them all at once. Each one resumes when you open it.',
      'This clears that pause so automatic restores start again, within the normal limits. It talks to the OCC running on this machine and never starts a server.',
      'It also lists restores from an older OCC client that this host refused, with the command that resumes each one.'
    ],
    examples: ['occ serve restore resume', 'occ serve restore resume --json']
  },
  {
    path: ['serve', 'service', 'install'],
    summary: 'Run occ serve as a per-user background service that restarts itself',
    usage:
      'occ serve service install [--port <port>] [--bind <ip>] [--pairing-address <host>] [--allow-public | --refuse-public] [--command <path>] [--dry-run] [--json]',
    allowedFlags: [
      ...LOCAL_COMMAND_FLAGS,
      'port',
      'bind',
      'pairing-address',
      'allow-public',
      'refuse-public',
      'command',
      'dry-run'
    ],
    notes: [
      'macOS writes a LaunchAgent; Linux writes a systemd user unit. Both run `occ serve --supervise --no-pairing` for this profile, so the server restarts with growing delays and gives up after repeated failures instead of looping.',
      'The service never prints a pairing link to its log. Pair clients with `occ pair` while it runs, or from the desktop app.',
      'On Linux the service stops at logout unless lingering is on (`loginctl enable-linger`); install reports it.',
      "Reinstalling replaces the unit and clears a previous give-up. --command defaults to the installed OCC app's `occ` command on PATH (`occ-ide` on Linux) and must not be a launcher tied to one OCC version. --dry-run prints the unit without installing it.",
      "Needs the OCC app installed on this machine. The `occ` command in an OCC terminal on an SSH host belongs to that connection's server and cannot install a service.",
      'Not available on Windows yet.'
    ],
    examples: [
      'occ serve service install',
      'occ serve service install --port 6768 --bind 127.0.0.1 --dry-run'
    ]
  },
  {
    path: ['serve', 'service', 'status'],
    summary: "Show whether this profile's occ serve service is running",
    usage: 'occ serve service status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Reports live, exited, or unverifiable (when the service manager cannot be asked), plus why the supervisor gave up if it did.'
    ],
    examples: ['occ serve service status', 'occ serve service status --json']
  },
  {
    path: ['serve', 'service', 'uninstall'],
    summary: "Stop and remove this profile's occ serve service",
    usage: 'occ serve service uninstall [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Stops the service and removes its unit file. The terminal daemon and its sessions keep running.'
    ],
    examples: ['occ serve service uninstall']
  }
]
