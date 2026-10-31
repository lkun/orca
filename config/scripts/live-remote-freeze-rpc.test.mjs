import { describe, expect, it } from 'vitest'
import {
  appendOCCRpcOutput,
  resolveOCCCliCommand,
  resolveOCCCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the OCC CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveOCCCliCommand({ env: { OCC_CLI_COMMAND: 'custom-occ' } })).toBe('custom-occ')
    expect(resolveOCCCliCommand({ env: { OCC_DEV_REPO_ROOT: '/repo' } })).toBe('occ-dev')
    expect(resolveOCCCliCommand({ env: {}, platform: 'linux' })).toBe('occ-ide')
    expect(resolveOCCCliCommand({ env: {}, platform: 'win32' })).toBe('occ')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveOCCCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        OCC_CLI_COMMAND: 'C:\\repo\\out\\bin\\occ-dev.cmd',
        OCC_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        OCC_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\occ-dev',
        OCC_DEV_CLI_INVOCATION: '1',
        OCC_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        OCC_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendOCCRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendOCCRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
