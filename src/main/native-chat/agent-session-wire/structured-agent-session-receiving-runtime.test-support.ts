import { OCCRuntimeService } from '../../runtime/occ-runtime'

export class ReceivingRuntime extends OCCRuntimeService {
  override getOrchestrationDbIfAvailable() {
    return super.getOrchestrationDbIfAvailable()
  }
  mailTarget(handle: string) {
    return this.resolveStructuredMailboxTarget(handle)
  }
}
