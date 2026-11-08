/** Whether the execution host is running or has queued an OCC Git command that can change this worktree. */
export type GitMutationInFlight = {
  inFlight: boolean
}
