import { OCCRuntimeRpcServer } from './runtime-rpc'
import { STATUS_METHODS } from '../methods/host-management/status'
import { TERMINAL_METHODS } from '../methods/terminal/terminal'
import { ORCHESTRATION_METHODS } from '../methods/orchestration/orchestration'

export function createLongPollServer(
  options: ConstructorParameters<typeof OCCRuntimeRpcServer>[0]
) {
  return new OCCRuntimeRpcServer({
    ...options,
    methods: [...STATUS_METHODS, ...TERMINAL_METHODS, ...ORCHESTRATION_METHODS]
  })
}
