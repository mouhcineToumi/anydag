import { Lock, LockOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LOCK_CHANGED, LOCK_KEYS, LOCK_REFUSED, isLocked, setLocked, toggleLock, useLocked } from "@/settings/lock";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/**
 * The lock's switch, at the end of the top bar on every page.
 *
 * Unlocked it is one quiet glyph beside the `⋯`; locked it is a pill that says *Read only*, in the
 * accent, because a page that refuses every edit has to say why before anybody tries one.
 * `aria-pressed`, since it is a switch, and the
 * key in the tooltip, which is the only place a key is written down.
 *
 * The class names are `dag-readonly*` rather than `dag-lock*`: `dag-lockup` is the logo's, and a name
 * one suffix from another is the namespace hazard `docs/architecture/things-that-will-bite.md` has recorded five times.
 */
export function LockButton() {
  const locked = useLocked();
  return (
    <button
      type="button"
      className={locked ? "dag-readonly dag-readonly--on" : "dag-icon dag-readonly"}
      data-dag-readonly={locked ? "on" : "off"}
      aria-pressed={locked}
      aria-label={locked ? "Read only: unlock to edit" : "Lock: read only"}
      title={
        locked
          ? `Read only: nothing here can be changed. Unlock (${LOCK_KEYS})`
          : `Lock: browse without changing anything (${LOCK_KEYS})`
      }
      /* A mouse press takes no focus, so the board's keys stay the board's — the sidebar toggle's
         rule. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => toggleLock()}
    >
      {locked ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
      {locked ? <span className="dag-readonly__word">Read only</span> : null}
    </button>
  );
}

/** How long the notice stays up after the last thing it was asked to say. */
const NOTICE_MS = 2600;

/**
 * What the lock says when it is switched, or when it stops something: a short line under
 * the top bar's right end, where the switch is, with Unlock on it while it is locked.
 *
 * A press on a locked page that did nothing and said nothing would read as a broken page, which is
 * the one thing a read-only mode must not look like. So every place that refuses a write calls
 * `refuseLocked()`, and this is where that is heard. `role="status"`, so a screen reader hears it too,
 * and never the focus: it is told, not asked.
 */
export function LockNotice() {
  const locked = useLocked();
  const [said, setSaid] = useState<"locked" | "unlocked" | "refused" | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const say = (what: "locked" | "unlocked" | "refused") => {
      setSaid(what);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaid(null), NOTICE_MS);
    };
    const onChange = () => say(isLocked() ? "locked" : "unlocked");
    const onRefused = () => say("refused");
    addEventListener(LOCK_CHANGED, onChange);
    addEventListener(LOCK_REFUSED, onRefused);
    return () => {
      removeEventListener(LOCK_CHANGED, onChange);
      removeEventListener(LOCK_REFUSED, onRefused);
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!said) return null;
  const text =
    said === "unlocked"
      ? "Unlocked: you can edit again."
      : said === "locked"
        ? "Read only: nothing here changes until you unlock."
        : "Read only: unlock to change this.";
  return (
    <div className="dag-readonly-notice" data-dag-readonly-notice={said} role="status">
      {said === "unlocked" ? <LockOpen {...ICON} /> : <Lock {...ICON} />}
      <span>{text}</span>
      {locked ? (
        <button
          type="button"
          className="dag-readonly-notice__unlock"
          data-dag-readonly-unlock=""
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLocked(false)}
        >
          Unlock
        </button>
      ) : null}
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
