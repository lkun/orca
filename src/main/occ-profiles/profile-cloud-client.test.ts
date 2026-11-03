import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelTrackingResponse } from '../lib/unread-response-body.test-fixtures'
import type { OCCCloudAuthConfig } from './profile-cloud-auth-config'
import type { OCCCloudSession } from './profile-cloud-session-store'
import { refreshOCCCloudCapabilities } from './profile-cloud-client'

const fetchMock = vi.fn()

const config: OCCCloudAuthConfig = {
  apiBaseUrl: 'https://occ-cloud.example',
  authorizeEndpoint: 'https://occ-cloud.example/v1/desktop/auth/authorize',
  sessionEndpoint: 'https://occ-cloud.example/v1/desktop/auth/session',
  refreshEndpoint: 'https://occ-cloud.example/v1/desktop/auth/refresh',
  capabilitiesEndpoint: 'https://occ-cloud.example/v1/desktop/auth/capabilities',
  profileEndpoint: 'https://occ-cloud.example/v1/desktop/auth/profile',
  orgEndpoint: 'https://occ-cloud.example/v1/desktop/auth/org',
  logoutEndpoint: 'https://occ-cloud.example/v1/desktop/auth/logout',
  relayTokenEndpoint: 'https://occ-cloud.example/v1/desktop/auth/relay-token',
  connectorTokenEndpoint: 'https://occ-cloud.example/v1/desktop/auth/connector-token',
  relayDirectorUrl: 'https://relay.example',
  clientId: 'desktop-client',
  scope: 'openid profile email offline_access'
}

const session: OCCCloudSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 999,
  capabilities: { flags: { share: true }, refreshedAt: 1 }
}

describe('OCC cloud client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('cancels the unread error-response body so bundled undici cannot crash on socket close', async () => {
    let cancelledBodies = 0
    fetchMock.mockResolvedValue(
      cancelTrackingResponse(502, () => {
        cancelledBodies += 1
      })
    )

    await expect(refreshOCCCloudCapabilities(config, session)).rejects.toThrow()
    expect(cancelledBodies).toBe(1)
  })
})
