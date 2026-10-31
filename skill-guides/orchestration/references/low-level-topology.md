# Low-level topology

```text
OCC terminal create --worktree active --title <task_name> --command "<agent_command>" --json
OCC terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
OCC orchestration dispatch --task <task_id> --to <handle> --inject --json
```
