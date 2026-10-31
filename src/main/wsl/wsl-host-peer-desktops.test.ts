import { describe, expect, it, vi } from 'vitest'
import { OCCD_PEER_DESKTOPS_RUNTIME_CAPABILITY } from '../../shared/occd-runtime-capabilities'
import { OCCD_PEER_DESKTOPS_METHOD } from '../../shared/occd-peer-desktops-contract'
import { readWslHostPeerDesktops } from './wsl-host-peer-desktops'

function server(peers: unknown, capabilities = [OCCD_PEER_DESKTOPS_RUNTIME_CAPABILITY]) {
  return vi.fn(async (method: string) => {
    if (method === 'status.get') {
      return { runtimeId: 'r', capabilities }
    }
    if (method === OCCD_PEER_DESKTOPS_METHOD) {
      return { peers }
    }
    throw new Error(`unexpected ${method}`)
  })
}

describe('readWslHostPeerDesktops', () => {
  it('names the other OCCs connected now, asking as this installation', async () => {
    const call = server([{ name: 'OCC Dev' }])
    await expect(readWslHostPeerDesktops(call, 'this-installation')).resolves.toEqual({
      kind: 'shared',
      names: ['OCC Dev']
    })
    expect(call).toHaveBeenCalledWith(OCCD_PEER_DESKTOPS_METHOD, {
      clientInstanceId: 'this-installation'
    })
  })

  it('lets the teardown proceed when no other OCC is connected', async () => {
    await expect(readWslHostPeerDesktops(server([]), 'this-installation')).resolves.toEqual({
      kind: 'none'
    })
  })

  it('reports an older server without asking it a method it lacks', async () => {
    const call = server([], [])
    await expect(readWslHostPeerDesktops(call, 'this-installation')).resolves.toEqual({
      kind: 'unsupported'
    })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('throws on an answer it cannot read, so the teardown is refused', async () => {
    await expect(readWslHostPeerDesktops(server('nope'), 'this-installation')).rejects.toThrow()
    const failing = vi.fn(async () => {
      throw new Error('timeout')
    })
    await expect(readWslHostPeerDesktops(failing, 'this-installation')).rejects.toThrow('timeout')
  })
})
