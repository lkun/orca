# OCC Orchestration

This discovery stub loads the version-matched guide from the OCC executable used for this session.

Never substitute a non-OCC subagent tool when the user asked for OCC orchestration.

<!-- shared: resolver -->

## Load the version-matched guide before running OCC commands

```text
OCC skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop and dispatched-worker
obligations. For a conditional action gate such as remote placement, uncertain release
recovery, or expanded DAG work, load only the reference that gate names with
`OCC skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`OCC skills get orchestration --full` and read the named bundled reference before acting.

<!-- shared-omit: no-guessing -->

Use the selected executable's `--help` for commands or flags the guide does not cover. If a
command reports that OCC is not running, start it with `OCC open --json` and retry. If it
fails with `runtime_access_denied`, your sandbox blocked the connection: re-run it with
escalated permissions, and do not run `OCC open` or restart OCC. If `skills get` is unknown,
explain that updating OCC restores the guide; use `--help` for read-only discovery and do not
guess unsupported commands.
