// `occ serve --supervise` runs occd under a service manager, which restarts it routinely.
import process from 'node:process'
import { OCC_SERVE_SUPERVISED_ENV } from '../../shared/serve-supervised-terminal-durability'

/** A supervised service must not hand out terminals that its next restart would kill. */
export class OCCdTerminalsNotDurableError extends Error {
  constructor(readonly daemonFailure: string) {
    super(
      `The terminal daemon did not start (${daemonFailure}). This server runs under a service ` +
        'manager, so it will not start with terminals that a restart would lose; the supervisor ' +
        'retries with backoff.'
    )
    this.name = 'OCCdTerminalsNotDurableError'
  }
}

/** Read once and drop it, so nothing occd starts inherits it. */
export function takeOCCdServeSupervision(env: NodeJS.ProcessEnv = process.env): boolean {
  const supervised = env[OCC_SERVE_SUPERVISED_ENV] === '1'
  delete env[OCC_SERVE_SUPERVISED_ENV]
  return supervised
}
