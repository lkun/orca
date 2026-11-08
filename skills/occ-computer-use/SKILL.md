---
name: occ-computer-use
description: >-
  Drives the GUI of a visible local app window through `occ computer`: accessibility
  tree, clicks, typing, menus, dialogs, and screenshots in native apps and external
  browser windows (Chrome, Edge, Safari) or webviews. Prefer a programmatic path
  (shell, filesystem, git, HTTP, existing CLIs) whenever it can complete the task.
  Use only when a visible window needs GUI control those cannot reach. Do not use
  for OCC's embedded browser (`occ-cli`).
---

# OCC Computer Use

This discovery stub loads the version-matched guide from the OCC executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `OCC_CLI_COMMAND` environment variable is set, use its value. OCC exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `OCC_DEV_REPO_ROOT`, use `occ-dev`.
- Otherwise, on Linux outside an OCC-managed terminal, use `occ-ide`. Never run bare
  `occ` there — outside OCC's terminals it normally resolves to the
  GNOME OCC screen reader (`/usr/bin/occ`) and starts speech on the user's machine.
- Otherwise, use `occ`.

Below, `OCC` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `OCC` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different OCC build.

## Load the version-matched guide before running OCC commands

```text
OCC skills get computer-use
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that OCC is not running, start it with `OCC open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `OCC open` or restart OCC. If
`skills get` is unknown, explain that updating OCC restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
