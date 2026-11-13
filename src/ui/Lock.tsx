import { Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { LOCK_KEYS, LOCK_REFUSED, setLocked, toggleLock, useLocked } from "@/settings/lock";
import { Button } from "@/ui/controls";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/**
 * The lock, at the end of the top bar on every page: one *Read only* pill with **Unlock** beside
 * it. It is the only place the lock is shown — the dock's *Locked* chip is the same switch for a
 * hand already on the board — and a refused write draws attention here rather than opening a
 * second banner under the bar.
 *
 * The pill shakes for a moment on a refusal, and does not move under `prefers-reduced-motion`; the
 * hidden live region beside it says the same thing to a reader that the shake says to an eye.
 * `data-dag-readonly`, and not `dag-lock*`: `dag-lockup` is the logo's, and a name one suffix from
 * another is the namespace hazard `docs/architecture/things-that-will-bite.md` has recorded.
 */
export function LockButton() {
  const locked = useLocked();
  const [refusals, setRefusals] = useState(0);

  useEffect(() => {
    if (!locked) setRefusals(0);
  }, [locked]);

  useEffect(() => {
    const onRefused = () => setRefusals((n) => n + 1);
    addEventListener(LOCK_REFUSED, onRefused);
    return () => removeEventListener(LOCK_REFUSED, onRefused);
  }, []);

  if (!locked) return null;
  return (
    <div className="dag-readonly" data-dag-readonly="on">
      {/* A new `key` on every refusal remounts the pill, which is what restarts a CSS animation
          that has already played. */}
      <span
        key={refusals}
        className={refusals ? "dag-readonly__pill dag-readonly__pill--shake" : "dag-readonly__pill"}
        data-dag-readonly-pill=""
        data-dag-readonly-shake={refusals ? "" : undefined}
      >
        <Lock {...ICON} />
        <span className="dag-readonly__word">Read only</span>
      </span>
      <Button
        className="dag-readonly__unlock"
        data-dag-readonly-unlock=""
        title={`Unlock (${LOCK_KEYS})`}
        /* A mouse press takes no focus, so the board's keys stay the board's — the sidebar
           toggle's rule. */
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setLocked(false)}
      >
        Unlock
      </Button>
      <span className="dag-readonly__said" role="status" aria-live="polite" aria-atomic="true">
        {refusals ? "Read only: unlock to change this." : ""}
      </span>
    </div>
  );
}

/**
 * `ctrl+shift+L` on every page, in the capture phase and stopped: it has to work with the caret in a
 * note's text and with focus on the table's grid, which stops every key it handles — and nothing in
 * the editor stack binds it (checked against BlockNote's and TipTap's keymaps, where the only
 * `Mod-Shift` bindings are 6 to 9 and S). Obsidian's own toggle is ctrl+E, which is the note
 * editor's inline code here.
 */
export function useLockKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.code !== "KeyL" && e.key.toLowerCase() !== "l") return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggleLock();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);
}

/**
 * The root says it is locked, so a rule can turn off what only means something to an editor — the
 * grab cursor over an item, a hover that offers a drag — without each component knowing. Painted,
 * like `data-zoom`: an attribute nobody renders.
 */
export function useLockedRoot(): void {
  const locked = useLocked();
  useEffect(() => {
    const root = document.documentElement;
    if (locked) root.dataset.dagLocked = "";
    else delete root.dataset.dagLocked;
    return () => {
      delete root.dataset.dagLocked;
    };
  }, [locked]);
}
