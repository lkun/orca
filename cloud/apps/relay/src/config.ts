import { z } from 'zod'
import {
  isRelayCellConnectionHardCap,
  RELAY_CELL_CONNECTION_HARD_CAP,
  RELAY_MAX_CELL_CONNECTION_UNOBSERVED_BOUND,
  RELAY_DEFAULT_REGION,
  RelayRegionSchema,
  relayCellAdmissionBounds,
  type RelayCellConnectionHardCap,
  type RelayRegion
} from '@occ-cloud/relay-contract'
import {
  RELAY_MAX_READINESS_GRACE_MS,
  RELAY_READINESS_JWKS_GRACE_MS,
  RELAY_READINESS_SQL_GRACE_MS
} from './relay-readiness.js'

export const RELAY_MAX_CELL_CAPACITY_REQUESTS = 100_000
export const RELAY_DATABASE_POOL_MAX = 10
export const RELAY_DIRECTOR_DATABASE_POOL_MAX = 3
export const RELAY_PUBLIC_RESOLVE_CONCURRENCY = 1
export const RELAY_PUBLIC_RESOLVE_WAIT_MS = 5_000
export { RELAY_CELL_CONNECTION_HARD_CAP }

const RelayCellConnectionHardCapSchema = z.custom<RelayCellConnectionHardCap>(
  isRelayCellConnectionHardCap
)

const EnvironmentBooleanSchema = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true')

const OptionalServiceAccountSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().email().optional()
)

// Cloud Run unset values arrive as empty strings, which coerce to 0 (fail-first readiness) instead of the grace default.
const readinessGraceSchema = (defaultMs: number) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(0).max(RELAY_MAX_READINESS_GRACE_MS).default(defaultMs)
  )

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  OCC_RELAY_PUBLIC_URL: z.string().url(),
  OCC_RELAY_CELL_URL: z.string().url(),
  OCC_RELAY_AUTH_ISSUER: z.string().url(),
  OCC_RELAY_AUTH_AUDIENCE: z.literal('occ-relay').default('occ-relay'),
  OCC_RELAY_JWKS_URL: z.string().url(),
  OCC_RELAY_ASSIGNMENT_SIGNING_KEY: z.string().min(32),
  OCC_RELAY_ROLE: z.enum(['combined', 'director', 'cell']).default('combined'),
  OCC_RELAY_CELL_ID: z.string().min(1).max(128).default('combined'),
  OCC_RELAY_REGION: RelayRegionSchema.default(RELAY_DEFAULT_REGION),
  OCC_RELAY_CELL_CAPACITY: z.coerce
    .number()
    .int()
    .positive()
    .max(RELAY_MAX_CELL_CAPACITY_REQUESTS)
    .default(900),
  OCC_RELAY_CELL_CONNECTION_HARD_CAP: z.coerce
    .number()
    .int()
    .pipe(RelayCellConnectionHardCapSchema)
    .optional(),
  OCC_RELAY_CELL_CONNECTION_UNOBSERVED_BOUND: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(RELAY_MAX_CELL_CONNECTION_UNOBSERVED_BOUND)
    .optional(),
  OCC_RELAY_CELLS_JSON: z.string().default('[]'),
  OCC_RELAY_ADMIN_AUDIENCE: z.string().url(),
  OCC_RELAY_DEPLOY_SERVICE_ACCOUNT: z.string().email(),
  OCC_RELAY_CAPACITY_SERVICE_ACCOUNT: OptionalServiceAccountSchema,
  OCC_RELAY_ASIA_PROOF_SERVICE_ACCOUNT: OptionalServiceAccountSchema,
  OCC_RELAY_MONITOR_SERVICE_ACCOUNT: OptionalServiceAccountSchema,
  OCC_RELAY_FENCE_SERVICE_ACCOUNT: OptionalServiceAccountSchema,
  OCC_RELAY_FENCE_BROKER_SERVICE_ACCOUNT: OptionalServiceAccountSchema,
  OCC_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT: OptionalServiceAccountSchema,
  OCC_RELAY_REHOME_AUDIENCE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional()
  ),
  OCC_RELAY_RUNTIME_SERVICE_ACCOUNT: z.string().email().optional(),
  OCC_RELAY_DIRECTOR_URL: z.string().url().optional(),
  OCC_RELAY_HEARTBEAT_AUDIENCE: z.string().url().optional(),
  OCC_RELAY_IMAGE_DIGEST: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  OCC_RELAY_ADMIN_JWKS_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/certs'),
  OCC_RELAY_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).optional(),
  OCC_RELAY_READINESS_JWKS_GRACE_MS: readinessGraceSchema(RELAY_READINESS_JWKS_GRACE_MS),
  OCC_RELAY_READINESS_SQL_GRACE_MS: readinessGraceSchema(RELAY_READINESS_SQL_GRACE_MS),
  OCC_RELAY_PUBLIC_ASSIGNMENTS_ENABLED: EnvironmentBooleanSchema,
  OCC_RELAY_REGIONAL_PLACEMENT_ENABLED: EnvironmentBooleanSchema,
  OCC_RELAY_REGION_CORRECTION_COHORT_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  // Step 5 on directors: `off` (default) is today's path; `dry-run` asks the picked cell to
  // check a booking without making it, and logs the answer; `on` places on switched-on cells.
  OCC_RELAY_RESERVE_PLACEMENT: z.enum(['off', 'dry-run', 'on']).default('off'),
  // Step 1 C: this share of hosts (by hash) on a reserve cell outside their region is booked
  // in it on reconnect; 0 (default) is off.
  OCC_RELAY_RESERVE_REHOME_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  // Step 3 shadow directory: unset or empty polls no cell; `all` or a comma list of cell ids.
  OCC_RELAY_SHADOW_SEAT_FEED_CELLS: z
    .string()
    .default('')
    .transform((value) =>
      value.trim() === 'all'
        ? ('all' as const)
        : value
            .split(',')
            .map((cellId) => cellId.trim())
            .filter((cellId) => cellId.length > 0)
    ),
  OCC_RELAY_PUBLIC_ASSIGNMENT_CONCURRENCY: z.coerce.number().int().positive().max(100).default(2),
  OCC_RELAY_PUBLIC_STICKY_CONCURRENCY: z.coerce.number().int().positive().max(100).default(1),
  OCC_RELAY_PUBLIC_STICKY_QUEUE_MAX: z.coerce.number().int().positive().max(4_096).default(64),
  OCC_RELAY_PUBLIC_STICKY_WAIT_MS: z.coerce.number().int().positive().max(30_000).default(2_000),
  OCC_RELAY_PUBLIC_STICKY_RETRY_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(60)
    .default(2),
  // Borrowed from placement concurrency, which always keeps at least one permit.
  OCC_RELAY_DRAIN_RETURN_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  OCC_RELAY_DRAIN_RETURN_QUEUE_MAX: z.coerce.number().int().positive().max(64).default(4),
  OCC_RELAY_DRAIN_RETURN_WAIT_MS: z.coerce.number().int().positive().max(10_000).default(3_000),
  // The desktop parser caps a Retry-After at 5 minutes; a larger value is truncated there.
  OCC_RELAY_DRAIN_RETURN_MAX_RETRY_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .min(2)
    .max(300)
    .default(300),
  OCC_RELAY_PUBLIC_ASSIGNMENT_QUEUE_MAX: z.coerce
    .number()
    .int()
    .positive()
    .max(4_096)
    .default(128),
  OCC_RELAY_PUBLIC_ASSIGNMENT_WAIT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(4_000),
  OCC_RELAY_PUBLIC_ASSIGNMENT_RETRY_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(300)
    .default(5),
  DATABASE_URL: z.string().optional(),
  OCC_RELAY_DATA_DIR: z.string().default('./data/relay')
})

const RelayCellConfigSchema = z
  .object({
    id: z.string().min(1).max(128),
    url: z.string().url(),
    capacityRequests: z.number().int().positive().max(RELAY_MAX_CELL_CAPACITY_REQUESTS),
    region: RelayRegionSchema.default(RELAY_DEFAULT_REGION),
    initiallyEnabled: z.boolean().optional(),
    connectionHardCap: RelayCellConnectionHardCapSchema.optional(),
    connectionUnobservedBound: z
      .number()
      .int()
      .nonnegative()
      .max(RELAY_MAX_CELL_CONNECTION_UNOBSERVED_BOUND)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.connectionHardCap === undefined) !==
      (value.connectionUnobservedBound === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'connection hard cap and unobserved bound must be configured together'
      })
    } else if (
      value.connectionHardCap !== undefined &&
      value.connectionUnobservedBound! >
        relayCellAdmissionBounds(value.connectionHardCap).maxUnobservedBound
    ) {
      context.addIssue({
        code: 'custom',
        path: ['connectionUnobservedBound'],
        message: 'connection unobserved bound must leave ordinary admission capacity'
      })
    }
  })

export type RelayCellConfig = Omit<z.infer<typeof RelayCellConfigSchema>, 'region'> & {
  region?: RelayRegion
}

export type RelayConfig = {
  port: number
  publicUrl: string
  cellUrl: string
  authIssuer: string
  authAudience: 'occ-relay'
  jwksUrl: string
  assignmentSigningKey: Uint8Array
  role: 'combined' | 'director' | 'cell'
  cellId: string
  region?: RelayRegion
  cells: RelayCellConfig[]
  adminAudience: string
  deployServiceAccount: string
  capacityServiceAccount?: string
  asiaProofServiceAccount?: string
  monitorServiceAccount?: string
  fenceServiceAccount?: string
  fenceBrokerServiceAccount?: string
  rehomeDirectorServiceAccount?: string
  rehomeAudience?: string
  shadowSeatFeedCells?: 'all' | string[]
  reservePlacement?: 'off' | 'dry-run' | 'on'
  reserveRehomePercent?: number
  runtimeServiceAccount: string
  directorUrl?: string
  heartbeatAudience?: string
  imageDigest?: string
  connectionHardCap?: RelayCellConnectionHardCap
  connectionUnobservedBound?: number
  adminJwksUrl: string
  databasePoolMax: number
  readinessJwksGraceMs?: number
  readinessSqlGraceMs?: number
  publicAssignmentsEnabled: boolean
  regionalPlacementEnabled?: boolean
  regionCorrectionCohortPercent?: number
  publicAssignmentConcurrency: number
  publicAssignmentQueueMax: number
  publicAssignmentWaitMs: number
  publicResolveConcurrency: number
  publicResolveWaitMs: number
  publicAssignmentRetryAfterSeconds: number
  publicStickyConcurrency?: number
  publicStickyQueueMax?: number
  publicStickyWaitMs?: number
  publicStickyRetryAfterSeconds?: number
  drainReturnConcurrency?: number
  drainReturnQueueMax?: number
  drainReturnWaitMs?: number
  drainReturnMaxRetryAfterSeconds?: number
  databaseUrl?: string
  dataDir: string
}

function canonicalOrigin(value: string, name: string): string {
  const url = new URL(value)
  if (url.origin !== value || url.pathname !== '/') throw new Error(`${name} must be an origin`)
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error(`${name} must use HTTPS outside loopback development`)
  }
  return value
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const parsed = EnvSchema.parse(env)
  const adminServiceAccounts = [
    parsed.OCC_RELAY_DEPLOY_SERVICE_ACCOUNT,
    parsed.OCC_RELAY_CAPACITY_SERVICE_ACCOUNT,
    parsed.OCC_RELAY_ASIA_PROOF_SERVICE_ACCOUNT,
    parsed.OCC_RELAY_MONITOR_SERVICE_ACCOUNT,
    parsed.OCC_RELAY_FENCE_SERVICE_ACCOUNT,
    parsed.OCC_RELAY_FENCE_BROKER_SERVICE_ACCOUNT,
    parsed.OCC_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT
  ].filter((value): value is string => value !== undefined)
  if (new Set(adminServiceAccounts).size !== adminServiceAccounts.length) {
    throw new Error('relay admin service accounts must be distinct')
  }
  if (
    (parsed.OCC_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT === undefined) !==
    (parsed.OCC_RELAY_REHOME_AUDIENCE === undefined)
  ) {
    throw new Error('relay rehome identity and audience must be configured together')
  }
  if (
    parsed.OCC_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT &&
    parsed.OCC_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT ===
      (parsed.OCC_RELAY_RUNTIME_SERVICE_ACCOUNT ?? parsed.OCC_RELAY_DEPLOY_SERVICE_ACCOUNT)
  ) {
    throw new Error('relay rehome director identity must differ from the cell runtime identity')
  }
  if (
    parsed.OCC_RELAY_REHOME_AUDIENCE &&
    new URL(parsed.OCC_RELAY_REHOME_AUDIENCE).pathname !== '/v1/admin/host-drain'
  ) {
    throw new Error('relay rehome audience must target the host drain route')
  }
  const directorUrl = parsed.OCC_RELAY_DIRECTOR_URL
    ? canonicalOrigin(parsed.OCC_RELAY_DIRECTOR_URL, 'OCC_RELAY_DIRECTOR_URL')
    : undefined
  const publicUrl = canonicalOrigin(parsed.OCC_RELAY_PUBLIC_URL, 'OCC_RELAY_PUBLIC_URL')
  const configuredCells = z
    .array(RelayCellConfigSchema)
    .max(128)
    .parse(JSON.parse(parsed.OCC_RELAY_CELLS_JSON) as unknown)
    .map((cell) => ({ ...cell, url: canonicalOrigin(cell.url, `cell ${cell.id}`) }))
  const ownCell = {
    id: parsed.OCC_RELAY_CELL_ID,
    region: parsed.OCC_RELAY_REGION,
    url: canonicalOrigin(parsed.OCC_RELAY_CELL_URL, 'OCC_RELAY_CELL_URL'),
    capacityRequests: parsed.OCC_RELAY_CELL_CAPACITY,
    connectionHardCap: parsed.OCC_RELAY_CELL_CONNECTION_HARD_CAP,
    connectionUnobservedBound: parsed.OCC_RELAY_CELL_CONNECTION_UNOBSERVED_BOUND,
    initiallyEnabled: true
  }
  if (
    (ownCell.connectionHardCap === undefined) !==
    (ownCell.connectionUnobservedBound === undefined)
  ) {
    throw new Error('connection hard cap and unobserved bound must be configured together')
  }
  if (
    ownCell.connectionHardCap !== undefined &&
    ownCell.connectionUnobservedBound! >
      relayCellAdmissionBounds(ownCell.connectionHardCap).maxUnobservedBound
  ) {
    throw new Error('connection unobserved bound must leave ordinary admission capacity')
  }
  const cells = parsed.OCC_RELAY_ROLE === 'director' ? configuredCells : [ownCell]
  if (cells.length === 0) throw new Error('director requires at least one configured cell')
  if (new Set(cells.map(({ id }) => id)).size !== cells.length) {
    throw new Error('relay cell ids must be unique')
  }
  const databasePoolMax =
    parsed.OCC_RELAY_DATABASE_POOL_MAX ??
    (parsed.OCC_RELAY_ROLE === 'director'
      ? RELAY_DIRECTOR_DATABASE_POOL_MAX
      : RELAY_DATABASE_POOL_MAX)
  if (
    parsed.OCC_RELAY_ROLE !== 'cell' &&
    parsed.OCC_RELAY_PUBLIC_ASSIGNMENT_CONCURRENCY >= databasePoolMax
  ) {
    throw new Error('public relay admission must leave database pool headroom')
  }
  if (
    parsed.OCC_RELAY_ROLE !== 'cell' &&
    parsed.OCC_RELAY_PUBLIC_ASSIGNMENT_CONCURRENCY + parsed.OCC_RELAY_PUBLIC_STICKY_CONCURRENCY >
      databasePoolMax
  ) {
    throw new Error('sticky and placement admission together must fit the database pool')
  }
  return {
    port: parsed.PORT,
    publicUrl,
    cellUrl: ownCell.url,
    authIssuer: canonicalOrigin(parsed.OCC_RELAY_AUTH_ISSUER, 'OCC_RELAY_AUTH_ISSUER'),
    authAudience: parsed.OCC_RELAY_AUTH_AUDIENCE,
    jwksUrl: parsed.OCC_RELAY_JWKS_URL,
    assignmentSigningKey: new TextEncoder().encode(parsed.OCC_RELAY_ASSIGNMENT_SIGNING_KEY),
    role: parsed.OCC_RELAY_ROLE,
    cellId: ownCell.id,
    region: ownCell.region,
    cells,
    adminAudience: parsed.OCC_RELAY_ADMIN_AUDIENCE,
    deployServiceAccount: parsed.OCC_RELAY_DEPLOY_SERVICE_ACCOUNT,
    capacityServiceAccount: parsed.OCC_RELAY_CAPACITY_SERVICE_ACCOUNT,
    asiaProofServiceAccount: parsed.OCC_RELAY_ASIA_PROOF_SERVICE_ACCOUNT,
    monitorServiceAccount: parsed.OCC_RELAY_MONITOR_SERVICE_ACCOUNT,
    fenceServiceAccount: parsed.OCC_RELAY_FENCE_SERVICE_ACCOUNT,
    fenceBrokerServiceAccount: parsed.OCC_RELAY_FENCE_BROKER_SERVICE_ACCOUNT,
    rehomeDirectorServiceAccount: parsed.OCC_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT,
    rehomeAudience: parsed.OCC_RELAY_REHOME_AUDIENCE,
    shadowSeatFeedCells: parsed.OCC_RELAY_SHADOW_SEAT_FEED_CELLS,
    reservePlacement: parsed.OCC_RELAY_RESERVE_PLACEMENT,
    reserveRehomePercent: parsed.OCC_RELAY_RESERVE_REHOME_PERCENT,
    runtimeServiceAccount:
      parsed.OCC_RELAY_RUNTIME_SERVICE_ACCOUNT ?? parsed.OCC_RELAY_DEPLOY_SERVICE_ACCOUNT,
    directorUrl,
    heartbeatAudience:
      parsed.OCC_RELAY_HEARTBEAT_AUDIENCE ??
      (directorUrl || parsed.OCC_RELAY_ROLE === 'director'
        ? new URL('/v1/admin/cell-heartbeat', directorUrl ?? publicUrl).toString()
        : undefined),
    imageDigest: parsed.OCC_RELAY_IMAGE_DIGEST,
    connectionHardCap: ownCell.connectionHardCap,
    connectionUnobservedBound: ownCell.connectionUnobservedBound,
    adminJwksUrl: parsed.OCC_RELAY_ADMIN_JWKS_URL,
    databasePoolMax,
    readinessJwksGraceMs: parsed.OCC_RELAY_READINESS_JWKS_GRACE_MS,
    readinessSqlGraceMs: parsed.OCC_RELAY_READINESS_SQL_GRACE_MS,
    publicAssignmentsEnabled: parsed.OCC_RELAY_PUBLIC_ASSIGNMENTS_ENABLED,
    regionalPlacementEnabled: parsed.OCC_RELAY_REGIONAL_PLACEMENT_ENABLED,
    regionCorrectionCohortPercent: parsed.OCC_RELAY_REGION_CORRECTION_COHORT_PERCENT,
    publicAssignmentConcurrency: parsed.OCC_RELAY_PUBLIC_ASSIGNMENT_CONCURRENCY,
    publicAssignmentQueueMax: parsed.OCC_RELAY_PUBLIC_ASSIGNMENT_QUEUE_MAX,
    publicAssignmentWaitMs: parsed.OCC_RELAY_PUBLIC_ASSIGNMENT_WAIT_MS,
    publicResolveConcurrency: RELAY_PUBLIC_RESOLVE_CONCURRENCY,
    publicResolveWaitMs: RELAY_PUBLIC_RESOLVE_WAIT_MS,
    publicAssignmentRetryAfterSeconds: parsed.OCC_RELAY_PUBLIC_ASSIGNMENT_RETRY_AFTER_SECONDS,
    publicStickyConcurrency: parsed.OCC_RELAY_PUBLIC_STICKY_CONCURRENCY,
    publicStickyQueueMax: parsed.OCC_RELAY_PUBLIC_STICKY_QUEUE_MAX,
    publicStickyWaitMs: parsed.OCC_RELAY_PUBLIC_STICKY_WAIT_MS,
    publicStickyRetryAfterSeconds: parsed.OCC_RELAY_PUBLIC_STICKY_RETRY_AFTER_SECONDS,
    drainReturnConcurrency: parsed.OCC_RELAY_DRAIN_RETURN_CONCURRENCY,
    drainReturnQueueMax: parsed.OCC_RELAY_DRAIN_RETURN_QUEUE_MAX,
    drainReturnWaitMs: parsed.OCC_RELAY_DRAIN_RETURN_WAIT_MS,
    drainReturnMaxRetryAfterSeconds: parsed.OCC_RELAY_DRAIN_RETURN_MAX_RETRY_AFTER_SECONDS,
    databaseUrl: parsed.DATABASE_URL,
    dataDir: parsed.OCC_RELAY_DATA_DIR
  }
}
