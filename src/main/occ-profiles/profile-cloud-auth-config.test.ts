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

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    expect(allowsPlaintextOCCCloudSession({ OCC_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)).toBe(
      false
    )
    expect(isOCCCloudDevAuthEnabled({ OCC_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })
})
