import type { TuiAgent } from './tui-agent'
export type { TuiAgent } from './tui-agent'

// Why: recognizing a manually started agent must not register an OCC launcher.
export type TerminalAgent = TuiAgent | 'dsb'
