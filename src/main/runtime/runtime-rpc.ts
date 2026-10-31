// Why: the single security boundary for the bundled CLI — auth-token enforcement, metadata publication, transport orchestration.
import { RuntimeRpcShutdown } from './runtime-rpc/runtime-rpc-shutdown'
import type { OCCRuntimeRpcServerOptions } from './runtime-rpc/runtime-rpc-pairing-types'

export class OCCRuntimeRpcServer extends RuntimeRpcShutdown {
  constructor(options: OCCRuntimeRpcServerOptions) {
    super(options)
  }
}
