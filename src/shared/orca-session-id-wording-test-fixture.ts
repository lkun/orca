/** Detect address used as a noun for OCC session identity; exclude verbs and distinct run:/dispatch:/group mailboxes. */
export const ORCA_SESSION_ID_AS_ADDRESS =
  /\b(?:orchestration|session|OCC|coordinator's|your(?: own)?) address\b|caller\.address|naming its address/i
