// #33849: an ~/.ssh/config host whose IdentityFile uses OpenSSH tokens connects with that key, not a password prompt.
// OCC_E2E_OCCD_CONVERT_HOST=docker; OCC_E2E_OCCD_CONVERT_TEMPLATE must be built for the Docker host.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/occ-app'
import { waitForSessionReady } from './helpers/store'
import { managedServer } from './helpers/occd-convert-flow'
import { openSshHostSettings, seedIsolatedSshConfig } from './helpers/ssh-config-host-picker'
import {
  OCCD_CONVERT_HOST_ENV,
  startOCCdConvertHost,
  type OCCdConvertHost
} from './helpers/occd-convert-host'

const HOST = process.env[OCCD_CONVERT_HOST_ENV]
const TEMPLATE_SOURCE = process.env.OCC_E2E_OCCD_CONVERT_TEMPLATE

test.skip(
  HOST !== 'docker' || !TEMPLATE_SOURCE,
  `Set ${OCCD_CONVERT_HOST_ENV}=docker and OCC_E2E_OCCD_CONVERT_TEMPLATE`
)
test.use({
  seedTestRepo: false,
  occAppExtraEnv: { OCC_OCCD_TEMPLATE_PATH: TEMPLATE_SOURCE ?? '', SSH_AUTH_SOCK: '' }
})

let host: OCCdConvertHost | null = null
let keyDir: string | null = null
test.afterEach(() => {
  host?.cleanup()
  host = null
  if (keyDir) {
    rmSync(keyDir, { recursive: true, force: true })
    keyDir = null
  }
})

test('an IdentityFile path with %r and %p tokens is the key Connect uses', async ({
  electronApp,
  occPage
}, testInfo) => {
  // Starts a Docker host and installs OCC's server there.
  test.setTimeout(6 * 60_000)
  host = startOCCdConvertHost('docker', testInfo)
  keyDir = mkdtempSync(path.join(os.tmpdir(), 'occ-identity-tokens-'))
  // %r and %p expand to root and the mapped port; ssh -G prints them unexpanded.
  copyFileSync(host.input.identityFile!, path.join(keyDir, `id-root-${host.input.port}`))
  const alias = `occ-tokens-${host.input.port}`
  await seedIsolatedSshConfig(
    electronApp,
    [
      `Host ${alias}`,
      `  HostName ${host.input.host}`,
      `  Port ${host.input.port}`,
      '  User root',
      `  IdentityFile ${keyDir}/id-%r-%p`,
      '  IdentitiesOnly yes',
      ''
    ].join('\n')
  )
  await waitForSessionReady(occPage)
  const targetId = await occPage.evaluate(async (configHost) => {
    const { target } = await window.api.ssh.addTarget({
      target: {
        label: configHost,
        configHost,
        host: configHost,
        port: 22,
        username: '',
        source: 'ssh-config'
      }
    })
    return target.id
  }, alias)
  const section = await openSshHostSettings(occPage)
  const card = section.locator(`[data-ssh-target-card][data-ssh-target-label="${alias}"]`)
  await card.hover()
  await card.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect
    .poll(() => managedServer(occPage, targetId), { timeout: 4 * 60_000 })
    .toMatchObject({ kind: 'managed' })
  await expect(occPage.getByRole('dialog', { name: 'SSH Password' })).toHaveCount(0)
})
