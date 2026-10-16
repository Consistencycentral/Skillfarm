// ===========================================================================
// Focus guard for Android forms (Sign in / Sign up and every other form).
//
// Problem: on some phones native focus jumps to ANOTHER text input by itself
// (Name -> Phone -> Email ...), even without a touch, so the user cannot type
// and the keyboard flickers or never opens.
//
// This guard never touches editable/enabled, so a normal tap always opens the
// keyboard. It only watches focus events:
//   * a tap marks "this input was touched";
//   * if a DIFFERENT input grabs focus right after that tap, or later with no
//     touch at all, focus is pushed back to the input the user really chose;
//   * a loop-breaker stops fighting after a few reverts, so a device that keeps
//     hopping can never get into an endless ping-pong - the user just types
//     wherever focus currently is.
// Pure logic (no React) so it can be unit-tested.
// ===========================================================================
export interface FocusGuard {
  touch(id: string, focus: () => void): void;
  focus(id: string, focus: () => void): void;
  blur(id: string): void;
}

export interface GuardClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

const TAP_WINDOW_MS = 700;      // focus within this long after a touch = that touch's focus
const CLEAR_AFTER_BLUR_MS = 300; // owner is forgotten when it blurs and nobody else focuses
const MAX_REVERTS = 4;          // ...per REVERT_WINDOW_MS, then give up
const REVERT_WINDOW_MS = 3000;

export function createFocusGuard(clock?: Partial<GuardClock>): FocusGuard {
  const c: GuardClock = {
    now: clock?.now ?? (() => Date.now()),
    setTimer: clock?.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: clock?.clearTimer ?? ((h) => clearTimeout(h as any)),
  };
  let pending: { id: string; focus: () => void; at: number } | null = null;
  let owner: { id: string; focus: () => void } | null = null;
  let clearTimer: unknown = null;
  let reverts: number[] = [];

  function revert(fn: () => void) {
    const t = c.now();
    reverts = reverts.filter((x) => t - x < REVERT_WINDOW_MS);
    if (reverts.length >= MAX_REVERTS) { owner = null; pending = null; return; } // give up
    reverts.push(t);
    fn();
  }

  return {
    touch(id, focus) { pending = { id, focus, at: c.now() }; },

    focus(id, focus) {
      if (clearTimer) { c.clearTimer(clearTimer); clearTimer = null; }
      if (pending && c.now() - pending.at < TAP_WINDOW_MS) {
        if (pending.id === id) { owner = { id, focus }; pending = null; return; }
        revert(pending.focus);            // hop right after a tap on another input
        return;
      }
      if (!owner || owner.id === id) { owner = { id, focus }; return; }
      revert(owner.focus);                // hop with no touch at all
    },

    blur(id) {
      if (!owner || owner.id !== id) return;
      if (clearTimer) c.clearTimer(clearTimer);
      clearTimer = c.setTimer(() => { owner = null; clearTimer = null; }, CLEAR_AFTER_BLUR_MS);
    },
  };
}
