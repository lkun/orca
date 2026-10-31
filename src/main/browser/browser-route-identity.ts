import { createHash } from 'node:crypto'

const MAX_IDENTITY_LENGTH = 512
const PARTITION_IDENTITY_VERSION = 1
const BROWSER_ROUTE_PARTITION_RE = /^persist:occ-browser-v1-[a-f0-9]{64}$/

export type BrowserRoutePartitionIdentity = Readonly<{
  occProfileId: string
  browserProfileId: string
  authorityConnectionIdentity: string
  executionHostIdentity: string
}>

export type DerivedBrowserRoutePartition = Readonly<{
  partition: string
  bindingFingerprint: string
}>

export function deriveBrowserRoutePartition(
  identity: BrowserRoutePartitionIdentity
): DerivedBrowserRoutePartition {
  const components = [
    ['occ-profile', identity.occProfileId],
    ['browser-profile', identity.browserProfileId],
    ['authority-connection', identity.authorityConnectionIdentity],
    ['execution-host', identity.executionHostIdentity]
  ] as const
  for (const [, value] of components) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      Buffer.byteLength(value, 'utf8') > MAX_IDENTITY_LENGTH
    ) {
      throw new Error('browser_route_partition_identity_invalid')
    }
  }

  return {
    partition: `persist:occ-browser-v${PARTITION_IDENTITY_VERSION}-${digest([
      'occ-browser-route-partition',
      PARTITION_IDENTITY_VERSION,
      ...components
    ])}`,
    bindingFingerprint: digest([
      'occ-browser-route-partition-binding',
      PARTITION_IDENTITY_VERSION,
      ...components
    ])
  }
}

// Lifecycle ownership must remain derivable without a live connection.
export function deriveBrowserRoutePartitionStorageScope(scope: {
  occProfileId: string
  environmentId: string
}): string {
  return digest([
    'occ-browser-route-partition-scope',
    PARTITION_IDENTITY_VERSION,
    ['occ-profile', scope.occProfileId],
    ['environment', scope.environmentId]
  ])
}

// Use a distinct digest domain for direct SSH ownership, independent of paired environments.
export function deriveLocalSshBrowserRoutePartitionStorageScope(scope: {
  occProfileId: string
  targetId: string
}): string {
  return digest([
    'occ-browser-route-partition-scope',
    PARTITION_IDENTITY_VERSION,
    ['occ-profile', scope.occProfileId],
    ['local-ssh-target', scope.targetId]
  ])
}

export function isBrowserRoutePartition(value: string): boolean {
  return BROWSER_ROUTE_PARTITION_RE.test(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}
