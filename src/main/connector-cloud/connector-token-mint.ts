// Connector tokens for the desktop's signed-in OCC account, fetched the way relay tokens are.
import { z } from 'zod'
import type { OCCCloudAuthConfig } from '../occ-profiles/profile-cloud-auth-config'
import { OCCCloudRequestError } from '../occ-profiles/profile-cloud-client'
import { runWithFreshOCCCloudSession } from '../occ-profiles/profile-cloud-session-refresh'
import { ensureActiveOCCProfile } from '../occ-profiles/profile-index-store'
import { loadOrCreateHostInstallationId } from '../runtime/host-descriptor'
import { requestConnector, type ConnectorFailure } from './connector-cloud-request'
import type { ConnectorTokenMint } from './connector-transport'

const ConnectorTokenResponse = z.object({
  connectorToken: z
    .string()
    .min(1)
    .max(8 * 1024),
  expiresAt: z.number().int().positive()
})

const SIGNED_OUT: ConnectorFailure = {
  ok: false,
  status: 401,
  error: 'signed_out',
  retryAfterMs: null
}

/** The account the connector serves, read like the relay's: the active profile's cloud user. */
export function connectorAccount(userDataPath: string): string | null {
  return ensureActiveOCCProfile(userDataPath).profile.cloud?.userId ?? null
}

/** Mints only for `account`; after a switch or sign-out the old client gets no token for the new one. */
export function desktopConnectorTokenMint(
  authConfig: OCCCloudAuthConfig,
  userDataPath: string,
  account: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): ConnectorTokenMint {
  return async () => {
    if (connectorAccount(userDataPath) !== account) {
      return SIGNED_OUT
    }
    const active = ensureActiveOCCProfile(userDataPath)
    try {
      // The per-install id the host descriptor already keeps; the cloud keys this machine on it.
      const machineId = await loadOrCreateHostInstallationId(userDataPath)
      const minted = await runWithFreshOCCCloudSession(
        authConfig,
        active,
        userDataPath,
        async (session) => {
          const answer = await requestConnector(
            {
              fetchImpl,
              url: authConfig.connectorTokenEndpoint,
              body: { machineId },
              token: session.accessToken
            },
            ConnectorTokenResponse
          )
          // Refreshes the OCC session once, as every desktop cloud call does.
          if (!answer.ok && (answer.status === 401 || answer.status === 403)) {
            throw new OCCCloudRequestError(answer.status, answer.error ?? undefined)
          }
          return answer
        }
      )
      return minted.status === 'ok' && connectorAccount(userDataPath) === account
        ? minted.value
        : SIGNED_OUT
    } catch (error) {
      return {
        ok: false,
        status: error instanceof OCCCloudRequestError ? error.statusCode : null,
        error: null,
        retryAfterMs: null
      }
    }
  }
}
