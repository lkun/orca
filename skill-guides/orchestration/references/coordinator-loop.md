# Coordinator loop

## Task DAGs

A Task needs a Run, so create one first. Workers editing the same files at once
need separate workspaces.

```text
OCC orchestration run-create --objective "<goal>" --json
OCC orchestration task-create --spec "<dependent work>" --deps <json_array> --json
OCC orchestration task-list --ready --brief --json
OCC orchestration worker-start --task <task_id> --worktree current --agent codex --json
```

On every wake, start the Tasks `task-list --ready` shows.

## Several Runs

A later `run-create` keeps your earlier Runs: their mail still wakes you, but
commands without `--run` use the newest Run, so pass `--run <id>` for an earlier
one. `run-use` keeps only the Run it names.

## Reusing a worker

To give a finished worker follow-up work, create the Task, then start it on the
terminal handle and workspace from that worker's earlier `worker-start` receipt:

```text
OCC orchestration task-create --spec "<follow-up>" --json
OCC orchestration worker-start --task <task_id> --terminal <agent_terminal_handle> --worktree <its_workspace> --json
```
