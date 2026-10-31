import { describe, expect, it, vi } from 'vitest'
import { formatServeRuntimeSelection } from '../../shared/occd-local-serve-selection'
import type { runProcess } from '@occ/process-host'
import { resolveLocalServeRuntime } from './serve-occd-launch'
import { occdServeArgs, serveOptionArgs } from '../../shared/occd-serve-argv'

type RunProcess = typeof runProcess

function answering(stdout: string, code = 0): RunProcess {
  return vi.fn<RunProcess>(async () => ({
    code,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false
  }))
}

const options = {
  executable: '/Applications/OCC.app/Contents/MacOS/OCC',
  appRoot: '/Applications/OCC.app/Contents/Resources/app.asar',
  userDataPath: '/Users/u/Library/Application Support/occ',
  usesMacUpdateHandoff: false
}

describe('occ serve asking the app which host to run', () => {
  it("requests the app's selection entry in Node mode and parses its answer", async () => {
    const selection = {
      kind: 'occd' as const,
      runtime: '/rt/node',
      entry: '/slot/occd.js',
      version: '1'
    }
    const run = answering(`noise\n${formatServeRuntimeSelection(selection)}\n`)
    expect(await resolveLocalServeRuntime(options, run)).toEqual(selection)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: options.executable,
        args: [
          `${options.appRoot}/out/main/occd/occd-local-serve-selection-entry.js`,
          '--user-data',
          options.userDataPath,
          '--app-root',
          options.appRoot
        ],
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
        stdio: ['ignore', 'pipe', 'inherit']
      })
    )
  })

  it('keeps packaged macOS on Electron without starting the app to ask', async () => {
    const run = answering('')
    expect(await resolveLocalServeRuntime({ ...options, usesMacUpdateHandoff: true }, run)).toEqual(
      {
        kind: 'electron',
        reason: expect.stringContaining('packaged macOS')
      }
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('selects Electron with a reason when the app gives no answer', async () => {
    expect(await resolveLocalServeRuntime(options, answering('', 1))).toEqual({
      kind: 'electron',
      reason: expect.stringContaining('did not answer')
    })
    const failing = vi.fn<RunProcess>(async () => {
      throw new Error('spawn ENOENT')
    })
    expect(await resolveLocalServeRuntime(options, failing)).toEqual({
      kind: 'electron',
      reason: expect.stringContaining('spawn ENOENT')
    })
  })

  it('renders occd serve options with the default bind address', () => {
    expect(
      occdServeArgs({
        json: true,
        port: '6768',
        pairingAddress: '10.0.0.5',
        noPairing: true,
        mobilePairing: true,
        recipeJson: true,
        projectRoot: '/work/app'
      })
    ).toEqual([
      '--bind',
      '0.0.0.0',
      '--json',
      '--port',
      '6768',
      '--pairing-address',
      '10.0.0.5',
      '--no-pairing',
      '--mobile-pairing',
      '--recipe-json',
      '--project-root',
      '/work/app'
    ])
    expect(occdServeArgs({})).toEqual(['--bind', '0.0.0.0'])
  })

  it("hands occd the app's browser client directory when the app has one", () => {
    expect(
      occdServeArgs({ port: '6768' }, '/opt/OCC/resources/app.asar.unpacked/out/web')
    ).toEqual([
      '--bind',
      '0.0.0.0',
      '--port',
      '6768',
      '--web-client-root',
      '/opt/OCC/resources/app.asar.unpacked/out/web'
    ])
  })

  it('spells the same flags with the --serve- prefix for the Electron host', () => {
    expect(
      serveOptionArgs(
        {
          json: true,
          port: '6768',
          pairingAddress: '10.0.0.5',
          noPairing: true,
          mobilePairing: true,
          grantDesktopControl: true,
          recipeJson: true,
          projectRoot: '/work/app'
        },
        '--serve-'
      )
    ).toEqual([
      '--serve-json',
      '--serve-port',
      '6768',
      '--serve-pairing-address',
      '10.0.0.5',
      '--serve-no-pairing',
      '--serve-mobile-pairing',
      '--serve-grant-desktop-control',
      '--serve-recipe-json',
      '--serve-project-root',
      '/work/app'
    ])
    expect(serveOptionArgs({ recipeJson: true }, '--serve-')).toEqual([])
  })
})
