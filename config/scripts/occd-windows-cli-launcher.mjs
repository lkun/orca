import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runProcessSync } from '@occ/process-host'
import { OCCD_WINDOWS_CLI_LAUNCHER_FILENAME } from '../../src/shared/occd-artifacts.ts'

const { PE_MACHINE, describePeMachine, readPeMachine } = createRequire(import.meta.url)(
  './windows-pe-machine.cjs'
)

export function occdWindowsCliLauncherSource(root, arch) {
  return join(root, '.build', 'windows-cli-launcher', arch, 'occ.exe')
}

/** A Windows slot's `occ` command; a Windows build host compiles a missing one. */
export function stageOCCdWindowsCliLauncher(
  root,
  outputDir,
  target,
  host = { platform: process.platform },
  compile = compileOCCdWindowsCliLauncher
) {
  if (!target.startsWith('win32-')) {
    return
  }
  const arch = target.slice('win32-'.length)
  const source = occdWindowsCliLauncherSource(root, arch)
  if (!existsSync(source)) {
    if (host.platform !== 'win32') {
      throw new Error(
        `OCCd ${target} requires the native CLI launcher. On Windows, run: ` +
          `node config/scripts/build-windows-cli-launcher.mjs --arch ${arch} --output ${source}`
      )
    }
    compile(root, arch, source)
  }
  const machine = readPeMachine(source)
  if (machine !== PE_MACHINE[arch]) {
    throw new Error(`OCCd ${target} CLI launcher has ${describePeMachine(machine)}`)
  }
  const destination = join(outputDir, ...OCCD_WINDOWS_CLI_LAUNCHER_FILENAME.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

function compileOCCdWindowsCliLauncher(root, arch, output) {
  const result = runProcessSync({
    program: process.execPath,
    args: [
      join(root, 'config/scripts/build-windows-cli-launcher.mjs'),
      '--arch',
      arch,
      '--output',
      output
    ],
    cwd: root,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    throw new Error(`Windows CLI launcher build for ${arch} failed with exit ${result.code}`)
  }
}
