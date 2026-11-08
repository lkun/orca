import type { RuntimeNotifier } from './runtime-notifier-contract'
import { OCCRuntimeWithPtyController } from '../../terminal/lifecycle/occ-runtime-pty-controller'

export abstract class RuntimeNotifierBinding extends OCCRuntimeWithPtyController {
  setNotifier(notifier: RuntimeNotifier | null): void {
    this.notifier = notifier
    if (notifier) {
      this.repositoryForkBackfill.start()
    }
  }

  protected countTerminalSideEffectConsumingClientEventListeners(): number {
    return this.clientEvents.countTerminalSideEffectConsumers()
  }
}
