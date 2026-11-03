import { describe, expect, it, vi } from 'vitest'
import {
  exportedTypeShape,
  runtimeShape
} from '../../../shared/plugins/authoring/plugin-author-typings.test-fixture'
import { createPluginWorkerRuntime, type PluginWorkerOCCApi } from './plugin-host-runtime'

async function activatedOCC(): Promise<PluginWorkerOCCApi> {
  const captured: { occ?: PluginWorkerOCCApi } = {}
  const runtime = createPluginWorkerRuntime({
    send: vi.fn(),
    exit: vi.fn(),
    importModule: async () => ({ default: (api: PluginWorkerOCCApi) => (captured.occ = api) })
  })
  await runtime.handleMessage({
    occ: 1,
    kind: 'evt',
    event: 'init',
    payload: {
      pluginId: 'samples.demo',
      pluginRoot: '/plugin',
      mainEntry: 'main.mjs',
      grantedCapabilities: []
    }
  })
  if (!captured.occ) {
    throw new Error('activate was not called')
  }
  return captured.occ
}

describe('occ-worker.d.ts matches the activate(occ) object', () => {
  it('declares exactly the members a worker gets', async () => {
    const typings = exportedTypeShape('occ/worker', 'OCCWorkerApi')
    expect(typings.optional).toEqual([])
    expect(runtimeShape(await activatedOCC())).toEqual(typings.shape)
  })
})
