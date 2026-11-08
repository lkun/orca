import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PAIR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pair'],
    summary:
      'Pair a phone or another OCC with the OCC already running here, without restarting it',
    usage:
      'occ pair [--mobile [--relay]] [--address <host>] [--grant-desktop-control] [--rotate] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mobile',
      'relay',
      'address',
      'grant-desktop-control',
      'rotate'
    ],
    notes: [
      'Asks the OCC running for this profile (desktop app, `occ serve`, or its service) for a pairing offer. Nothing restarts and existing clients stay connected.',
      'Without --mobile it prints an access link for another OCC (Settings → Remote OCC Servers → Add Server). --mobile prints a QR code and link for OCC Mobile.',
      '--address is the host or IP the client should dial, such as a Tailscale address. Without it OCC picks this machine’s default LAN address.',
      'The first network pairing makes a loopback-only OCC listen on every interface, as pairing from the desktop app does.',
      'Mobile pairing is LAN-only (same network or tailnet) unless --relay is given; Relay needs a signed-in desktop app.',
      'An unused offer is reused until --rotate replaces it. Clients that already paired keep their access.',
      "--grant-desktop-control lets the paired OCC drive this machine's desktop (occ computer). It applies only to an access link, not to a phone.",
      'Only this machine’s own user can run it: paired clients and phones cannot create pairing offers.'
    ],
    examples: [
      'occ pair --mobile',
      'occ pair --mobile --address 100.64.1.20',
      'occ pair --address 100.64.1.20',
      'occ pair --mobile --rotate --json'
    ]
  }
]
