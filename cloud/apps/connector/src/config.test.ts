import { describe, expect, it } from 'vitest'
import { loadConnectorConfig } from './config.js'

const ENV = {
  OCC_CONNECTOR_PUBLIC_URL: 'https://connector.onocc.dev',
  OCC_CONNECTOR_AUTH_ISSUER: 'https://login.onocc.dev',
  OCC_CONNECTOR_JWKS_URL: 'https://login.onocc.dev/.well-known/jwks.json'
}

describe('connector config', () => {
  it('fills defaults around the required settings', () => {
    expect(loadConnectorConfig(ENV)).toEqual({
      mode: 'active',
      role: 'api',
      port: 8080,
      publicUrl: 'https://connector.onocc.dev',
      dataDir: './data/connector',
      databasePoolMax: 10,
      authIssuer: 'https://login.onocc.dev',
      jwksUrl: 'https://login.onocc.dev/.well-known/jwks.json',
      trustedProxyHops: 0
    })
  })

  it('treats a blank database URL as absent', () => {
    expect(loadConnectorConfig({ ...ENV, OCC_CONNECTOR_DATABASE_URL: ' ' }).databaseUrl).toBe(
      undefined
    )
  })

  it.each([
    ['a path on the public URL', { OCC_CONNECTOR_PUBLIC_URL: 'https://connector.onocc.dev/x' }],
    ['plain HTTP off loopback', { OCC_CONNECTOR_AUTH_ISSUER: 'http://login.onocc.dev' }],
    ['a missing key set URL', { OCC_CONNECTOR_JWKS_URL: undefined }],
    ['a plain HTTP key set URL', { OCC_CONNECTOR_JWKS_URL: 'http://login.onocc.dev/jwks' }],
    ['the gateway role without Discord', { OCC_CONNECTOR_ROLE: 'discord-gateway' }]
  ])('rejects %s', (_name, override) => {
    expect(() => loadConnectorConfig({ ...ENV, ...override })).toThrow()
  })

  it('allows plain HTTP on loopback for local development', () => {
    expect(
      loadConnectorConfig({ ...ENV, OCC_CONNECTOR_PUBLIC_URL: 'http://127.0.0.1:8080' }).publicUrl
    ).toBe('http://127.0.0.1:8080')
  })
})
