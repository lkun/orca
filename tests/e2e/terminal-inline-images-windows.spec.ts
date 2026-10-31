import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/occ-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  assertInlineImagePixels,
  assertKittyPlaceholderPixels,
  enableInlineImages,
  inlineImagePayload
} from './helpers/terminal-inline-image-proof'
import { getFirstWslDistro, useWslRuntimeForActiveProject } from './helpers/wsl-golden-stub-agent'
import { nodeTerminalCommand } from './terminal-node-command'
import { proveWindowsKittyFileImage } from './helpers/terminal-kitty-file-image-proof'

test.skip(process.platform !== 'win32', 'Native Windows and WSL PTY coverage')

for (const runtime of ['native', 'wsl'] as const) {
  for (const acceleration of ['off', 'on'] as const) {
    test(`@headful ${runtime}, ${acceleration}: PTY images and Kitty placeholders render on Windows`, async ({
      occPage,
      testRepoPath
    }, testInfo) => {
      await waitForSessionReady(occPage)
      await ensureTerminalVisible(occPage)
      await occPage.evaluate(async (policy) => {
        await window.__store!.getState().updateSettings({ terminalGpuAcceleration: policy })
      }, acceleration)
      if (runtime === 'wsl') {
        const distro = await getFirstWslDistro(occPage)
        expect(distro, 'This Windows verification requires an installed WSL distro').not.toBeNull()
        if (!distro) {
          throw new Error('No WSL distro available')
        }
        await useWslRuntimeForActiveProject(occPage, distro)
      } else {
        await occPage.evaluate(async () => {
          await window
            .__store!.getState()
            .updateSettings({ terminalWindowsShell: 'powershell.exe' })
        })
      }
      const tabId = await occPage.evaluate(() => {
        const state = window.__store!.getState()
        const worktreeId = state.activeWorktreeId
        if (!worktreeId) {
          throw new Error('Missing verification worktree')
        }
        const tab = state.createTab(worktreeId)
        window.__store!.getState().setActiveTab(tab.id)
        window.__store!.getState().setActiveTabType('terminal', worktreeId)
        return tab.id
      })
      await expect(
        occPage.locator(`[data-tab-id="${tabId}"] [data-shell-icon]`).first()
      ).toHaveAttribute('data-shell-icon', runtime === 'wsl' ? 'wsl.exe' : 'powershell.exe')
      await waitForActiveTerminalManager(occPage, 30_000)
      await enableInlineImages(occPage)
      await expect
        .poll(() =>
          occPage.evaluate(() => {
            const tab = window.__store!.getState().activeTabId
            const manager = tab && window.__paneManagers?.get(tab)
            const pane = manager && manager.getActivePane()
            return Boolean(manager && pane && manager.hasWebglRenderer(pane.id))
          })
        )
        .toBe(acceleration === 'on')
      const ptyId = await waitForActivePanePtyId(occPage)
      const marker = 'WINDOWS_INLINE_IMAGES_DONE'
      const rawPayload = `${inlineImagePayload(true)}${marker}\r\n`
      const payload = Buffer.from(rawPayload).toString('base64')
      // Stage a file: the command is typed before WSL bash reaches readline, where cooked TTY input truncates ~25KB lines at 4095 bytes.
      const payloadFile = `.occ-inline-images-${randomUUID()}.bin`
      if (runtime === 'wsl') {
        writeFileSync(path.join(testRepoPath, payloadFile), rawPayload)
      }
      const command =
        runtime === 'wsl'
          ? `cat ${payloadFile}; rm -f ${payloadFile}; printf 'WSL_IMAGE_PROTOCOL=%s\\n' "$OCC_IMAGE_PROTOCOL"`
          : nodeTerminalCommand(['-e', `process.stdout.write(Buffer.from('${payload}', 'base64'))`])
      await execInTerminal(occPage, ptyId, command)
      await waitForTerminalOutput(occPage, marker, 30_000)
      if (runtime === 'wsl') {
        await waitForTerminalOutput(occPage, 'WSL_IMAGE_PROTOCOL=kitty', 30_000)
      }
      await assertInlineImagePixels(occPage, testInfo.outputPath('windows-inline-protocols.png'))
      await assertKittyPlaceholderPixels(
        occPage,
        testInfo.outputPath('windows-inline-placeholders.png')
      )
      await proveWindowsKittyFileImage(
        occPage,
        ptyId,
        runtime,
        testInfo.outputPath('windows-file-placeholders.png')
      )
    })
  }
}
