import { describe, expect, it, vi } from 'vitest'
import { formatServeRuntimeSelection } from '../../shared/occd-local-serve-selection'
import type { runProcess } from '@occ/process-host'
import { resolveLocalServeRuntime } from './serve-occd-launch'

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

  it('asks the app on packaged macOS when occd is requested explicitly', async () => {
    const selection = {
      kind: 'occd' as const,
      runtime: '/rt/node',
      entry: '/slot/occd.js',
      version: '1'
    }
    const run = answering(formatServeRuntimeSelection(selection))
    expect(
      await resolveLocalServeRuntime(
        { ...options, usesMacUpdateHandoff: true, env: { OCC_SERVE_RUNTIME: 'occd' } },
        run
      )
    ).toEqual(selection)
  })
})
