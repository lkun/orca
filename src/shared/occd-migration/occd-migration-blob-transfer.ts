/** Opaque migration blobs travel beside the signed catalog. Gate each kind by its destination capability:
 * older destinations drop unknown kinds, so clients must refuse before staging. */
import { z } from 'zod'
import {
  OCCD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  OCCdMigrationChunkBase64Schema,
  OCCdMigrationDigestSchema,
  OCCdMigrationIdentitySchema,
  decodeOCCdMigrationChunk
} from './occd-migration-scrollback'
import { requiredRecord } from './occd-migration-dormant-value-validation'
import { assertUniqueKeys } from './occd-migration-manifest-fields'
import { OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../occd-runtime-capabilities'

export const OCCD_MIGRATION_BLOB_KINDS = [
  'terminal-restore-hints',
  'shell-history',
  'agent-session-records',
  'terminal-history'
] as const

export type OCCdMigrationBlobKind = (typeof OCCD_MIGRATION_BLOB_KINDS)[number]

type OCCdMigrationBlobKindContract = {
  /** Filename-safe, dot-free and lowercase, so a key is one path segment on any filesystem. */
  key: RegExp
  maxBytes: number
  capability: string
}

const MIB = 1024 * 1024

export const OCCD_MIGRATION_BLOB_KIND_CONTRACTS: Record<
  OCCdMigrationBlobKind,
  OCCdMigrationBlobKindContract
> = {
  // One JSON document per migration; the received directory already scopes it to the migration.
  'terminal-restore-hints': {
    key: /^migration$/,
    maxBytes: 4 * MIB,
    capability: 'occd.migration-blob.terminal-restore-hints.v1'
  },
  // `hashWorktreeId` (16 hex) plus the shell whose history file it is.
  'shell-history': {
    key: /^[a-f0-9]{16}-(?:zsh|bash|fish)$/,
    maxBytes: 64 * MIB,
    capability: 'occd.migration-blob.shell-history.v1'
  },
  // The agent session id; agent CLIs mint lowercase UUID-like ids.
  'agent-session-records': {
    key: /^[a-z0-9][a-z0-9_-]{0,127}$/,
    maxBytes: 64 * MIB,
    capability: 'occd.migration-blob.agent-session-records.v1'
  },
  // 16 hex of the pane key's sha256; the session id it restores as travels inside.
  'terminal-history': {
    key: /^[a-f0-9]{16}$/,
    maxBytes: 16 * MIB,
    capability: 'occd.migration-blob.terminal-history.v1'
  }
}

// The same bound the shared chunk decoder enforces for both channels.
export const OCCD_MIGRATION_BLOB_CHUNK_BYTES = OCCD_MIGRATION_SCROLLBACK_CHUNK_BYTES
export const MAX_OCCD_MIGRATION_BLOBS = 1024
export const MAX_OCCD_MIGRATION_BLOB_TOTAL_BYTES = 256 * MIB

/** Byte-for-byte what the destination must hold; empty content is sent as no blob at all. */
export type OCCdMigrationBlobDescriptor = {
  blobKind: OCCdMigrationBlobKind
  key: string
  sha256: string
  byteLength: number
}

export type OCCdMigrationBlobUploadState = OCCdMigrationBlobDescriptor & {
  receivedBytes: number
}

export const OCCD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED =
  'occd_migration_destination_blob_kind_unsupported'

// Windows refuses these as file names whatever the extension, so a key must never be one.
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

export const OCCdMigrationBlobDescriptorSchema = z
  .object({
    blobKind: z.enum(OCCD_MIGRATION_BLOB_KINDS),
    key: z.string().max(256),
    sha256: OCCdMigrationDigestSchema,
    byteLength: z.number().int().min(1)
  })
  .superRefine((value, context) => {
    const contract = OCCD_MIGRATION_BLOB_KIND_CONTRACTS[value.blobKind]
    if (!contract.key.test(value.key) || WINDOWS_RESERVED_FILE_NAME.test(value.key)) {
      context.addIssue({
        code: 'custom',
        message: 'occd_migration_blob_key_invalid'
      })
    }
    if (value.byteLength > contract.maxBytes) {
      context.addIssue({ code: 'custom', message: 'occd_migration_blob_too_large' })
    }
  })

// Not strict: an older host must ignore optional fields a newer client adds.
export const OCCdMigrationBlobChunkRequestSchema = z.object({
  migrationId: OCCdMigrationIdentitySchema,
  manifestSha256: OCCdMigrationDigestSchema,
  blob: OCCdMigrationBlobDescriptorSchema,
  offset: z.number().int().nonnegative().max(MAX_OCCD_MIGRATION_BLOB_TOTAL_BYTES),
  bytesBase64: OCCdMigrationChunkBase64Schema
})

export type OCCdMigrationBlobChunkRequest = z.infer<typeof OCCdMigrationBlobChunkRequestSchema>

export type OCCdMigrationBlobChunkResult = {
  migrationId: string
  manifestSha256: string
  blobKind: OCCdMigrationBlobKind
  key: string
  receivedBytes: number
}

export function parseOCCdMigrationBlobDescriptor(value: unknown): OCCdMigrationBlobDescriptor {
  const parsed = OCCdMigrationBlobDescriptorSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'occd_migration_blob_descriptor_invalid')
  }
  return {
    blobKind: parsed.data.blobKind,
    key: parsed.data.key,
    sha256: parsed.data.sha256,
    byteLength: parsed.data.byteLength
  }
}

export function assertOCCdMigrationBlobSet(
  descriptors: readonly OCCdMigrationBlobDescriptor[]
): void {
  if (descriptors.length > MAX_OCCD_MIGRATION_BLOBS) {
    throw new Error('occd_migration_blobs_too_many')
  }
  assertUniqueKeys([...descriptors], occdMigrationBlobIdentity, 'occd_migration_blob_duplicate')
  const total = descriptors.reduce((sum, entry) => sum + entry.byteLength, 0)
  if (total > MAX_OCCD_MIGRATION_BLOB_TOTAL_BYTES) {
    throw new Error('occd_migration_blobs_too_large')
  }
}

export function occdMigrationBlobIdentity(
  descriptor: Pick<OCCdMigrationBlobDescriptor, 'blobKind' | 'key'>
): string {
  return `${descriptor.blobKind}\0${descriptor.key}`
}

export function sameOCCdMigrationBlob(
  left: OCCdMigrationBlobDescriptor,
  right: OCCdMigrationBlobDescriptor
): boolean {
  return (
    left.blobKind === right.blobKind &&
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  )
}

/** The channel plus each kind's capability; empty when nothing is sent. */
export function requiredMigrationBlobCapabilities(
  descriptors: readonly Pick<OCCdMigrationBlobDescriptor, 'blobKind'>[]
): string[] {
  if (descriptors.length === 0) {
    return []
  }
  const kinds = new Set(descriptors.map((entry) => entry.blobKind))
  return [
    OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...OCCD_MIGRATION_BLOB_KINDS.filter((kind) => kinds.has(kind)).map(
      (kind) => OCCD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}

/** The first kind the destination cannot install, so the refusal names what would be lost. */
export function findUnsupportedMigrationBlobKind(
  descriptors: readonly Pick<OCCdMigrationBlobDescriptor, 'blobKind'>[],
  capabilities: readonly string[]
): OCCdMigrationBlobKind | null {
  const advertised = new Set(capabilities)
  for (const descriptor of descriptors) {
    if (
      !advertised.has(OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY) ||
      !advertised.has(OCCD_MIGRATION_BLOB_KIND_CONTRACTS[descriptor.blobKind].capability)
    ) {
      return descriptor.blobKind
    }
  }
  return null
}

export function occdMigrationBlobKindUnsupportedBlocker(kind: OCCdMigrationBlobKind): string {
  return `${OCCD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED}:${kind}:Update OCC on this host to move this project's ${kind} to it.`
}

export function decodeOCCdMigrationBlobChunk(bytesBase64: string): Buffer {
  return decodeOCCdMigrationChunk(bytesBase64, 'occd_migration_blob_chunk_invalid')
}

/** Absent on hosts that predate blobs or hold none staged; both mean every blob starts at 0. */
export function parseOCCdMigrationBlobUploadStates(
  value: unknown
): OCCdMigrationBlobUploadState[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > MAX_OCCD_MIGRATION_BLOBS) {
    throw new Error('occd_migration_blob_state_invalid')
  }
  const uploads = value.map((entry) => {
    // Fails closed on an unknown kind by design: only blobs this desktop staged can appear here.
    const record = requiredRecord(entry, 'occd_migration_blob_state_invalid')
    const descriptor = parseOCCdMigrationBlobDescriptor(record)
    if (
      !Number.isSafeInteger(record.receivedBytes) ||
      Number(record.receivedBytes) < 0 ||
      Number(record.receivedBytes) > descriptor.byteLength
    ) {
      throw new Error('occd_migration_blob_state_invalid')
    }
    return { ...descriptor, receivedBytes: Number(record.receivedBytes) }
  })
  assertOCCdMigrationBlobSet(uploads)
  return uploads
}

export function parseOCCdMigrationBlobChunkResult(
  value: unknown,
  request: OCCdMigrationBlobChunkRequest
): OCCdMigrationBlobChunkResult {
  const record = requiredRecord(value, 'occd_migration_blob_chunk_result_invalid')
  const receivedBytes = request.offset + decodeOCCdMigrationBlobChunk(request.bytesBase64).length
  if (
    record.migrationId !== request.migrationId ||
    record.manifestSha256 !== request.manifestSha256 ||
    record.blobKind !== request.blob.blobKind ||
    record.key !== request.blob.key ||
    record.receivedBytes !== receivedBytes
  ) {
    throw new Error('occd_migration_blob_chunk_result_invalid')
  }
  return {
    migrationId: request.migrationId,
    manifestSha256: request.manifestSha256,
    blobKind: request.blob.blobKind,
    key: request.blob.key,
    receivedBytes
  }
}

/** Kinds this build's destination installs after commit; each is added with its installer. */
export const OCCD_MIGRATION_INSTALLABLE_BLOB_KINDS: readonly OCCdMigrationBlobKind[] = [
  'terminal-restore-hints',
  'shell-history',
  'terminal-history'
]

/** Moved panes' terminal history installs only on a WSL host, the one destination a WSL move has. */
export function advertisedOCCdMigrationBlobCapabilities(host: { wslHost: boolean }): string[] {
  return [
    OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...OCCD_MIGRATION_INSTALLABLE_BLOB_KINDS.filter(
      (kind) => kind !== 'terminal-history' || host.wslHost
    ).map((kind) => OCCD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability)
  ]
}
