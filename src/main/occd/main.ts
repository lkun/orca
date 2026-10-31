import '../memory/host-malloc-tunables-claim'
import process from 'node:process'
import { main } from './occd-entry'
import { resolveOCCdExitCode } from './occd-exit-code'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { runOCCdNativePreflightVerdict } from './occd-native-preflight'
import {
  OCCD_PROFILE_PREFLIGHT_FLAG,
  OCCD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/occd-profile-preflight'
import { onNodePtyLoadFailure } from '../providers/node-pty-load-failure'
import {
  confirmBundledOCCdStartupQualified,
  discardBundledOCCdStartupQualification,
  forgetBundledOCCdStartupQualification,
  preflightBundledOCCdStartup,
  runOCCdProfilePreflight
} from './occd-profile-preflight'
import { assertOCCdServerRuntime } from './occd-bundled-runtime'
import {
  formatOCCdNativePreflightReport,
  OCCD_NATIVE_PREFLIGHT_FLAG
} from '../../shared/occd-native-preflight-report'
import {
  OCCD_CANCEL_MANAGED_STOP_FLAG,
  OCCD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/occd-stop-request'
import {
  OCCD_WINDOWS_BREAKAWAY_CONTRACT,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG
} from '../../shared/windows-breakaway-launch'
import { runWindowsBreakawayLaunchIfRequested } from '../../shared/windows-breakaway-launcher'
import { parseArgs } from './occd-command-arguments'
import { OCCD_RECLAIM_STALE_LOCK_FLAG } from '../../shared/occd-stale-lock-reclaim'

// A resolved plain-Node module graph proves the build guard; skip probes, ports and data-root locks.
if (process.argv.includes('--occd-smoke-load-check')) {
  process.exit(0)
}

function failStartup(error: unknown): void {
  console.error('occd: failed to start:', error)
  // Distinguish configuration refusals so supervisors cannot restart-spin on them.
  process.exit(resolveOCCdExitCode(error))
}

// One-shot launch and stop commands must skip server startup and preflights.
if (process.argv[2] === '--occd-structured-provider-load-check') {
  void import('./occd-structured-provider-smoke')
    .then(({ smokeLoadOCCdStructuredProviders }) => smokeLoadOCCdStructuredProviders())
    .then(() => process.exit(0))
    .catch(failStartup)
} else if (process.argv[2] === WINDOWS_BREAKAWAY_LAUNCH_FLAG) {
  runWindowsBreakawayLaunchIfRequested(OCCD_WINDOWS_BREAKAWAY_CONTRACT, process.argv)
} else if (
  process.argv[2] === OCCD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === OCCD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./occd-managed-stop-command').then(({ runOCCdManagedStopCommandAndExit }) =>
    runOCCdManagedStopCommandAndExit(process.argv.slice(2))
  )
} else if (process.argv[2] === OCCD_RECLAIM_STALE_LOCK_FLAG) {
  void import('./occd-stale-lock-reclaim').then(({ runOCCdStaleLockReclaimCommandAndExit }) =>
    runOCCdStaleLockReclaimCommandAndExit(process.argv.slice(2))
  )
} else {
  startOCCdProcess()
}

function startOCCdProcess(): void {
  try {
    const argv = process.argv.slice(2)
    if ((argv.includes('--help') || argv.includes('-h')) && parseArgs(argv).help) {
      void main(argv).catch(failStartup)
      return
    }
    assertOCCdServerRuntime()
    const flag = process.argv[2]
    if (flag === OCCD_NATIVE_PREFLIGHT_FLAG && process.argv.length === 3) {
      void import('./node-pty-precondition').then(({ checkNodePtyPrecondition }) => {
        const verdict = checkNodePtyPrecondition()
        const report = formatOCCdNativePreflightReport(verdict.status, verdict.reason ?? null)
        process.stdout.write(`${report}\n`, () => process.exit(0))
      }, failStartup)
    } else if (
      (flag === OCCD_STARTUP_PREFLIGHT_FLAG && process.argv.length === 4) ||
      (flag === OCCD_PROFILE_PREFLIGHT_FLAG &&
        (process.argv.length === 4 || process.argv.length === 5))
    ) {
      void runOCCdProfilePreflight(process.argv[3], {
        nativeFeatures: flag === OCCD_PROFILE_PREFLIGHT_FLAG,
        servedUserDataPath: process.argv[4]
      })
        // The owner reads EOF; lingering native handles must not keep this probe alive.
        .then(() => process.stdout.write('', () => process.exit(0)))
        .catch(failStartup)
    } else {
      // Stdout is the readiness API; send incidental diagnostics to stderr.
      reserveServeStdoutForReadiness()
      void preflightBundledOCCdStartup()
        .then((qualified) => {
          onNodePtyLoadFailure(() => void discardBundledOCCdStartupQualification())
          // Probe before deferred node-pty loading can crash this process; a slot qualified on this
          // unchanged host passed it on its last launch.
          if (runOCCdNativePreflightVerdict({ qualified }) !== 'ok') {
            forgetBundledOCCdStartupQualification()
          }
          return main()
        })
        .then(confirmBundledOCCdStartupQualified)
        .catch(failStartup)
    }
  } catch (error) {
    failStartup(error)
  }
}
