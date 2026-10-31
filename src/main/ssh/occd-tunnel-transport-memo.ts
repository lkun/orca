export type OCCdTunnelTransport = 'tcp_forward' | 'stdio_bridge'

const transports = new Map<string, OCCdTunnelTransport>()

export function rememberOCCdTunnelTransport(
  targetId: string,
  transport: OCCdTunnelTransport
): void {
  transports.set(targetId, transport)
}

export function knownOCCdTunnelTransport(targetId: string): OCCdTunnelTransport | null {
  return transports.get(targetId) ?? null
}
