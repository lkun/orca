/**
 * WSL reads an active slot's liveness, readiness and pid in one guest command; SSH keeps
 * `probeActiveOCCdReadiness`'s separate reads. The answers are judged exactly as those are.
 */
import type { OCCdHostTarget } from '../../ssh/occd-host-transport'
import type { OCCdRemoteContext } from '../../managed-server/install/occd-remote-context'
import { occdLivenessProbeCommand } from '../../managed-server/install/occd-remote-launch'
import { readOCCdReadinessNowCommand } from '../../managed-server/install/occd-remote-readiness-wait'
import { execOCCdRemote } from '../../managed-server/install/occd-remote-runtime-control'
import { OCCD_PID_FILENAME } from '../../managed-server/install/occd-remote-host-support'
import { managedOCCdInstallDir } from '../../managed-server/lifecycle/occd-managed-runtime-context'
import {
  activeOCCdReadinessFromOutput,
  assertActiveOCCdLive,
  OCCdActiveReadinessError
} from '../../ssh/occd-active-readiness'
import { computeLocalOCCdBuildHash } from '../../ssh/occd-local-build-hash'
import type { ServeReadiness } from '../../server/serve-readiness'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'

const SECTION_END = '__OCC_WSL_ACTIVE_PROBE_END__'

type WslContext = OCCdRemoteContext<OCCdHostTarget>

function pidCommand(context: WslContext, fullVersion: string): string {
  const pidFile = joinRemotePath(
    context.host,
    managedOCCdInstallDir(context, fullVersion),
    OCCD_PID_FILENAME
  )
  return `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`
}

function parsePid(output: string): number | null {
  const pid = Number.parseInt(output, 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

export async function readWslOCCdPid(
  context: WslContext,
  fullVersion: string,
  signal?: AbortSignal
): Promise<number | null> {
  return parsePid(
    await execCommand(context.connection, pidCommand(context, fullVersion), { signal })
  )
}

/** Each section ends with a marker on its own line; the newline before it is the probe's own. */
export function wslOCCdActiveProbeCommand(context: WslContext, fullVersion: string): string {
  const installDir = managedOCCdInstallDir(context, fullVersion)
  const end = `printf '\\n%s\\n' ${SECTION_END}`
  return [
    occdLivenessProbeCommand(context.host, installDir),
    end,
    readOCCdReadinessNowCommand(context.host, installDir),
    end,
    pidCommand(context, fullVersion)
  ].join('\n')
}

export async function probeWslActiveOCCd(
  context: WslContext,
  localOCCdDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<{ readiness: ServeReadiness; pid: number | null }> {
  const output = await execOCCdRemote(
    { conn: context.connection, host: context.host, signal },
    wslOCCdActiveProbeCommand(context, fullVersion)
  )
  const sections = output.split(`\n${SECTION_END}\n`)
  if (sections.length !== 3) {
    throw new OCCdActiveReadinessError(
      'unverifiable',
      `occd ${fullVersion} process state is unverifiable.`
    )
  }
  const [liveness = '', readiness = '', pid = ''] = sections
  const expectation = { buildHash: computeLocalOCCdBuildHash(localOCCdDir), fullVersion }
  assertActiveOCCdLive(liveness, expectation)
  return {
    readiness: activeOCCdReadinessFromOutput(context.host, readiness, expectation),
    pid: parsePid(pid)
  }
}
