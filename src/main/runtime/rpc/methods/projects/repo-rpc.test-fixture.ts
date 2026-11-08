import { RpcDispatcher } from '../../dispatcher'
import type { RpcRequest } from '../../core'
import type { OCCRuntimeService } from '../../../occ-runtime'
import { REPO_METHODS } from './repo'

export function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

export function repoDispatcher(
  runtime: Pick<OCCRuntimeService, 'getRuntimeId'> & Partial<OCCRuntimeService>
) {
  return new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: These RPC cases supply every runtime method their handlers and envelope access.
    runtime: runtime as OCCRuntimeService,
    methods: REPO_METHODS
  })
}
