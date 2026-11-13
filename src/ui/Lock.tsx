import { Lock, LockOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  LOCK_CHANGED,
  LOCK_KEYS,
  LOCK_REFUSED,
  type LockSaid,
  isLocked,
  lockNoticeLeaves,
  lockNoticeText,
  setLocked,
  toggleLock,
  useLocked,
} from "@/settings/lock";
import { Button, IconButton } from "@/ui/controls";

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
  /* Not `IconButton`: locked, the same control is a pill with a word on it, and one element that
     changes its drawing keeps focus across the press, where swapping components would drop it. */
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
 * `refuseLocked()`, and this is where that is heard. **The *locked* and *unlocked* lines leave after
 * 2.6 s**, because the top-bar pill and the cards already say the app is locked, and a card that sat
 * over the Calendar's toolbar for ever would be the same problem the other way round. **A *refused*
 * line stays until it is dismissed or the app is unlocked**, so a press that was stopped is not a
 * flash the person missed; it wears a `×` that puts it away. Every timer holds while the pointer or
 * the focus is on the notice, so the buttons cannot vanish under a click. `role="status"`, so a
 * screen reader hears it too, and never the focus: it is told, not asked.
 */
export function LockNotice() {
  const locked = useLocked();
  const [said, setSaid] = useState<LockSaid | null>(() => (isLocked() ? "locked" : null));
  const timer = useRef<number | undefined>(undefined);
  /** A pointer or a focus on the notice holds the one line that would otherwise leave. */
  const held = useRef(false);

  useEffect(() => {
    const stop = () => window.clearTimeout(timer.current);
    const leave = () => {
      stop();
      timer.current = window.setTimeout(() => setSaid(null), NOTICE_MS);
    };
    const say = (what: LockSaid) => {
      setSaid(what);
      stop();
      /* A refusal waits for its dismiss; the two announcements leave. */
      if (lockNoticeLeaves(what) && !held.current) leave();
    };
    const onChange = () => say(isLocked() ? "locked" : "unlocked");
    const onRefused = () => say("refused");
    addEventListener(LOCK_CHANGED, onChange);
    addEventListener(LOCK_REFUSED, onRefused);
    /* A page loaded locked says so once, then leaves the controls it covers alone. */
    if (isLocked()) leave();
    return () => {
      removeEventListener(LOCK_CHANGED, onChange);
      removeEventListener(LOCK_REFUSED, onRefused);
      stop();
    };
  }, []);

  if (!said) return null;
  const hold = () => {
    held.current = true;
    window.clearTimeout(timer.current);
  };
  const release = () => {
    held.current = false;
    if (!lockNoticeLeaves(said)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaid(null), NOTICE_MS);
  };
  return (
    <div
      className="dag-readonly-notice"
      data-dag-readonly-notice={said}
      role="status"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release();
      }}
    >
      {said === "unlocked" ? <LockOpen {...ICON} /> : <Lock {...ICON} />}
      <span>{lockNoticeText(said)}</span>
      {locked ? (
        <Button data-dag-readonly-unlock="" onMouseDown={(e) => e.preventDefault()} onClick={() => setLocked(false)}>
          Unlock
        </Button>
      ) : null}
      {said === "refused" ? (
        <IconButton
          data-dag-readonly-dismiss=""
          aria-label="Dismiss"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            held.current = false;
            setSaid(null);
          }}
        >
          <X {...ICON} />
        </IconButton>
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
