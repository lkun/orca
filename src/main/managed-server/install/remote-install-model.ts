// Each install model owns its namespace; GC must never delete another model's live directories.
import {
  relayArtifactFilenames,
  RELAY_INSTALL_COMPLETE_FILENAME,
  RELAY_VERSION_FILENAME
} from '../../ssh/relay-install-artifacts'
import {
  occdArtifactFilenames,
  OCCD_INSTALL_COMPLETE_FILENAME,
  OCCD_RUNTIMES_DIRNAME,
  OCCD_VERSION_FILENAME
} from '../../../shared/occd-artifacts'
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

type RemoteInstallModelId = 'relay' | 'occd'

export type RemoteInstallModel = {
  readonly id: RemoteInstallModelId
  /** Leading segment of every version dir: `<dirPrefix>-<fullVersion>`. */
  readonly dirPrefix: string
  /** npm package name written into the remote `package.json` for native deps. */
  readonly nativeDepsPackageName: string
  readonly versionFilename: string
  readonly installCompleteFilename: string
  /** Files whose absence means a torn install, so the probe forces a re-deploy. */
  requiredArtifacts(host: RemoteHostPlatform): string[]
}

export const RELAY_INSTALL_MODEL: RemoteInstallModel = {
  id: 'relay',
  dirPrefix: 'relay',
  nativeDepsPackageName: 'occ-relay',
  versionFilename: RELAY_VERSION_FILENAME,
  installCompleteFilename: RELAY_INSTALL_COMPLETE_FILENAME,
  requiredArtifacts: (host) => relayArtifactFilenames(isWindowsRemoteHost(host))
}

export const OCCD_INSTALL_MODEL: RemoteInstallModel = {
  id: 'occd',
  dirPrefix: 'occd',
  nativeDepsPackageName: 'occ-occd',
  versionFilename: OCCD_VERSION_FILENAME,
  installCompleteFilename: OCCD_INSTALL_COMPLETE_FILENAME,
  // libc does not change slot filenames; require the manifest for hashed page assets.
  requiredArtifacts: (host) => occdArtifactFilenames(`${host.os}-${host.arch}`, [])
}

export const REMOTE_INSTALL_MODELS: readonly RemoteInstallModel[] = [
  RELAY_INSTALL_MODEL,
  OCCD_INSTALL_MODEL
]

// This pattern also runs in awk ERE and PowerShell; use their shared [0-9] syntax.
const VERSION_PATTERN = String.raw`v?[0-9]+\.[0-9]+\.[0-9]+(\+[0-9a-f]+)?`

// Surface interrupted-GC tombstones in listings so later passes can finish deletion.
const TOMBSTONE_PATTERN = String.raw`\.gc-tombstone\.[0-9]+\.[0-9]+`

// Prefixes enter host globs, regexes and shell literals; reject metacharacters before interpolation.
function assertSafeDirPrefix(dirPrefix: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(dirPrefix)) {
    throw new Error(`Unsafe remote install dir prefix: ${JSON.stringify(dirPrefix)}`)
  }
}

export function remoteInstallDirName(model: RemoteInstallModel, fullVersion: string): string {
  assertSafeDirPrefix(model.dirPrefix)
  return `${model.dirPrefix}-${fullVersion}`
}

export function remoteInstallVersionDirRegex(model: RemoteInstallModel): RegExp {
  assertSafeDirPrefix(model.dirPrefix)
  return new RegExp(`^${model.dirPrefix}-(${VERSION_PATTERN})$`)
}

export function remoteInstallGcTombstoneRegex(model: RemoteInstallModel): RegExp {
  assertSafeDirPrefix(model.dirPrefix)
  return new RegExp(`^${model.dirPrefix}-(${VERSION_PATTERN})${TOMBSTONE_PATTERN}$`)
}

export function remoteInstallListingRegexSource(model: RemoteInstallModel): string {
  assertSafeDirPrefix(model.dirPrefix)
  return `^${model.dirPrefix}-(${VERSION_PATTERN})(${TOMBSTONE_PATTERN})?$`
}

export function remoteInstallDirOwner(dirName: string): RemoteInstallDirOwner | null {
  if (dirName === OCCD_RUNTIMES_DIRNAME) {
    return 'runtimes'
  }
  for (const model of REMOTE_INSTALL_MODELS) {
    if (new RegExp(remoteInstallListingRegexSource(model)).test(dirName)) {
      return model.id
    }
  }
  return null
}

export function remoteInstallGcPermits(model: RemoteInstallModel, dirName: string): boolean {
  return remoteInstallDirOwner(dirName) === model.id
}

// Only runtime-store GC may collect shared runtimes; version-directory models cannot own them.
type RemoteInstallDirOwner = RemoteInstallModelId | 'runtimes'

type RemoteInstallInventory = Record<RemoteInstallDirOwner | 'unknown', string[]>

export function inventoryRemoteInstallDirs(dirNames: readonly string[]): RemoteInstallInventory {
  const inventory: RemoteInstallInventory = { relay: [], occd: [], runtimes: [], unknown: [] }
  for (const name of dirNames) {
    const owner = remoteInstallDirOwner(name)
    if (owner) {
      inventory[owner].push(name)
    } else {
      inventory.unknown.push(name)
    }
  }
  return inventory
}
