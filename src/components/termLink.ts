// The trainer's serial terminal lives in its own browser tab (/z80/terminal). The
// emulator runs in the board tab; the two tabs talk over a BroadcastChannel:
// the terminal tab says hello every couple of seconds (and the board answers
// with its state), the board pushes its state whenever the TxD log or the
// receiver changes, and typed bytes go back to the board tab that answered.

export const TERM_PATH = '/z80/terminal';
const CHANNEL = 'mipslab.z80.terminal';
/** window name, so opening the terminal again brings back the same tab instead of another */
export const TERM_WINDOW = 'mipslab-z80-terminal';
/** how often the terminal tab says hello, and how long either side waits before calling the other gone */
export const HELLO_MS = 2000;
export const LOST_MS = 5000;

export interface TermState {
  /** bumps on every power-on of the emulator, so the terminal knows to start a fresh screen */
  run: number;
  tx: number[];
  txDropped: number;
  rxOn: boolean;
  pending: number;
  running: boolean;
}

export type TermMsg =
  /** terminal → boards: I'm here (`to` = the board it follows, or null while looking for one) */
  | { k: 'hello'; from: string; to: string | null }
  /** board → terminals: current state; null when the board has no trainer (so no 8251A) */
  | { k: 'state'; from: string; s: TermState | null }
  /** terminal → board: bytes typed into the terminal */
  | { k: 'send'; from: string; to: string; bytes: number[] }
  /** either side: this tab is closing */
  | { k: 'bye'; from: string };

export const newTabId = () => Math.random().toString(36).slice(2, 10);

/** Opens the terminal tab, or brings back the one already open without reloading it. False if the browser blocked it. */
export function openTermTab(): boolean {
  const w = window.open('', TERM_WINDOW);
  if (!w) return false;
  if (w.location.href === 'about:blank') w.location.href = TERM_PATH;
  w.focus();
  return true;
}

/** A channel to the other tabs, or null where the browser has no BroadcastChannel. */
export function openLink(onMsg: (m: TermMsg) => void): { post: (m: TermMsg) => void; close: () => void } | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<TermMsg>) => onMsg(e.data);
  return { post: (m) => ch.postMessage(m), close: () => ch.close() };
}
