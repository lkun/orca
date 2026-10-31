import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextOCCCloudSession,
  getOCCCloudAuthConfig,
  isOCCCloudDevAuthEnabled
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('OCC cloud auth config', () => {
  it('reports unconfigured without both API URL and client ID', () => {
    expect(getOCCCloudAuthConfig({})).toEqual({
      configured: false,
      setupMessage: 'OCC Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getOCCCloudAuthConfig({
      OCC_CLOUD_API_URL: 'https://occ-cloud.example/',
      OCC_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state).toEqual({
      configured: true,
      config: {
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
        relayDirectorUrl: 'https://relay.onocc.dev',
        clientId: 'desktop-client',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getOCCCloudAuthConfig({}, true)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.onocc.dev',
        authorizeEndpoint: 'https://login.onocc.dev/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://login.onocc.dev/v1/desktop/auth/session',
        refreshEndpoint: 'https://login.onocc.dev/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://login.onocc.dev/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://login.onocc.dev/v1/desktop/auth/profile',
        orgEndpoint: 'https://login.onocc.dev/v1/desktop/auth/org',
        logoutEndpoint: 'https://login.onocc.dev/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://login.onocc.dev/v1/desktop/auth/relay-token',
        connectorTokenEndpoint: 'https://login.onocc.dev/v1/desktop/auth/connector-token',
        relayDirectorUrl: 'https://relay.onocc.dev',
        clientId: 'occ-desktop',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getOCCCloudAuthConfig({
      OCC_CLOUD_API_URL: 'http://localhost:4100',
      OCC_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged builds', () => {
    expect(
      getOCCCloudAuthConfig(
        {
          OCC_CLOUD_API_URL: 'http://localhost:4100',
          OCC_CLOUD_CLIENT_ID: 'desktop-client'
        },
        true
      )
    ).toMatchObject({ configured: false })

    const httpsState = getOCCCloudAuthConfig(
      {
        OCC_CLOUD_API_URL: 'https://occ-cloud.example',
        OCC_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )
    expect(httpsState.configured).toBe(true)
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getOCCCloudAuthConfig({
        OCC_CLOUD_API_URL: 'http://occ-cloud.example',
        OCC_CLOUD_CLIENT_ID: 'desktop-client'
      })
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextOCCCloudSession({
        OCC_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextOCCCloudSession({
        OCC_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    expect(allowsPlaintextOCCCloudSession({ OCC_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)).toBe(
      false
    )
    expect(isOCCCloudDevAuthEnabled({ OCC_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isOCCCloudDevAuthEnabled({
        OCC_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isOCCCloudDevAuthEnabled({
        OCC_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
