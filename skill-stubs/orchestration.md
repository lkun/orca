# OCC Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched OCC
orchestration reference is served by the `occ` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Use OCC orchestration to run work in separate OCC worker agents and get their results
back: when the user asks for OCC workers or supervision (monitor, task DAGs, ask/reply,
decision gates), or when the work needs something your own subagents cannot give, such as a
different agent or its own OCC workspace. "Have Codex (or Claude) review this and report
back" means an OCC worker of that agent, even when you have your own model subagents. Use
it as well when you are a dispatched worker sending `ask` questions or `worker_done`. Otherwise prefer your own subagents,
including for long or parallel work. Use the occ-cli skill instead to hand work off with
nothing expected back ("hand off", "handoff", "handover", "give this to another agent",
"another worktree"), and for ordinary terminal control, shell commands, worktree management,
and the built-in browser. Coordination requires real OCC runtime state; never substitute a
non-OCC subagent tool when the user asked for OCC orchestration.

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

<!-- shared: no-guessing -->
