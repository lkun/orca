// A Connect whose SSH session never opens names SSH's reason, not a server failure with a plain-SSH fallback.
// OCC_E2E_OCCD_CONVERT_HOST=docker; OCC_E2E_OCCD_CONVERT_TEMPLATE must be built for the Docker host.
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/occ-app'
import { waitForSessionReady } from './helpers/store'
import { createRestartSession } from './helpers/occ-restart'
import { openSshHostSettings } from './helpers/ssh-config-host-picker'
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

let host: OCCdConvertHost | null = null
test.afterEach(() => {
  host?.cleanup()
  host = null
})

const CASES = [
  {
    name: 'a refused SSH port',
    reason: /ECONNREFUSED/,
    nextStep: 'Nothing accepted the SSH connection at this address',
    refused: true
  },
  {
    name: 'a key the host rejects',
    reason: /authentication methods failed/i,
    nextStep: 'The host didn’t accept any sign-in OCC offered',
    refused: false
  }
] as const

for (const fault of CASES) {
  // oxlint-disable-next-line no-empty-pattern -- Playwright's first fixture arg must be an object pattern; this test owns its app launch.
  test(`Connect to ${fault.name} says why SSH failed`, async ({}, testInfo) => {
    // Starts a Docker host and an app; a rejected key also waits on its password prompt.
    test.setTimeout(6 * 60_000)
    host = startOCCdConvertHost('docker', testInfo)
    if (!fault.refused) {
      host.exec!(': > /root/.ssh/authorized_keys')
    }
    const input = { ...host.input, ...(fault.refused ? { port: 1 } : {}) }
    // No agent, so the only offered key is the one the host rejects.
    const session = createRestartSession(testInfo, {
      OCC_OCCD_TEMPLATE_PATH: TEMPLATE_SOURCE!,
      SSH_AUTH_SOCK: ''
    })
    let app: ElectronApplication | null = null
    try {
      const launched = await session.launch()
      app = launched.app
      const page = launched.page
      await waitForSessionReady(page)
      await page.evaluate((target) => window.api.ssh.addTarget({ target }), input)
      const section = await openSshHostSettings(page)
      const card = section.locator(`[data-ssh-target-card][data-ssh-target-label="${input.label}"]`)
      await card.hover()
      await card.getByRole('button', { name: 'Connect', exact: true }).click()
      if (!fault.refused) {
        // The rejected key falls back to a password prompt; the user dismisses it.
        const prompt = page.getByRole('dialog', { name: 'SSH Password' })
        await expect(prompt).toBeVisible({ timeout: 60_000 })
        await prompt.getByRole('button', { name: 'Cancel' }).click()
      }
      await expect(card).toContainText(fault.reason, { timeout: 2 * 60_000 })
      await page.screenshot({ path: testInfo.outputPath('card.png') })
      await expect(card).toContainText(fault.nextStep)
      await expect(card).not.toContainText('couldn’t start its server')
      await expect(card.getByRole('button', { name: 'Open plain SSH terminal' })).toHaveCount(0)
      const toasts = page.locator('[data-sonner-toast]')
      await expect(toasts.filter({ hasText: 'Error invoking remote method' })).toHaveCount(0)
      await expect(toasts.filter({ hasText: 'couldn’t start its server' })).toHaveCount(0)
    } finally {
      if (app) {
        await session.close(app)
      }
      await session.dispose()
    }
  })
}
