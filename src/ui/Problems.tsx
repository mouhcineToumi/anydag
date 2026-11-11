import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, X } from "lucide-react";

import { itemName } from "@/board/types";
import type { Fix, Repair } from "@/edit/repair";
import type { ProblemsShow } from "@/settings/store";

import { count, freshErrors, type Problem } from "./problemList";

/** Lucide at one size and weight, stated once. */
const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** How long the set has to hold still before it can interrupt — longer than a pause between two keystrokes. */
const SETTLE = 1000;
/** How long a notification stays up, unless the pointer is resting on it. */
const SHOW_FOR = 6000;

interface Props {
  problems: readonly Problem[];
  show: ProblemsShow;
  /** The item open in the editor panel: its problems are listed there, so they never pop up here. */
  editing: string | null;
  /** A page's name, for the list — a problem on another page says which. */
  pageName(id: string): string | undefined;
  /** "Show me": the item open in the panel, with the thing the problem concerns picked. */
  onShow(p: Problem): void;
  /**
   * What a problem can be put right with, in words: `planRepair`'s answer for it, or `null` when the
   * file has nothing to offer. Absent when the board cannot be written.
   */
  repairOf?(p: Problem): Repair | null;
  /** Carry a repair out. Resolves to a sentence when it could not be, `null` when it was. */
  onRepair?(fix: Fix): Promise<string | null>;
}

/**
 * The problems dock: a count at the bottom of the board, a list behind it, and a notification that
 * goes away on its own.
 *
 * It replaced a red card that sat on the canvas above the board's content with no way to put it
 * away — on the one surface that is meant to be a picture, and until somebody fixed the text. A
 * problem here is something to read when you want to, not something the drawing is hidden behind.
 *
 * Three rules keep it from nagging, and each is `problems.ts`'s rather than this file's:
 *
 * - **It waits for the set to hold still.** The panel writes the file a quarter of a second after
 *   the last keystroke, so typing through a half-written line produces an error per pause; a
 *   notification only goes up once nothing has changed for a second.
 * - **It interrupts only about what is new.** A key seen at the last reading does not come back,
 *   and × is a promise that this set will not be shown again. Moving a broken line down one does not
 *   make it new — the key has no line in it.
 * - **Never about the item being edited, and never about a warning.** The first is in the panel
 *   already; the second never stopped anything from being drawn.
 *
 * Chrome, not diagram: `App` leaves it out under `?snapshot=1`, where nothing but the board is drawn.
 */
export function Problems({ problems, show, editing, pageName, onShow, repairOf, onRepair }: Props) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Problem[] | null>(null);
  /* The keys at the last settled reading. A ref, not state: it decides what is new and draws nothing. */
  const seen = useRef<Set<string>>(new Set());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { errors, warnings } = count(problems);
  /* One string standing for the whole set, so the settle effect fires on a change of *content* —
     `problems` is a fresh array after every write whether or not anything in it changed. */
  const signature = useMemo(() => problems.map((p) => `${p.key}@${p.line}`).join("\n"), [problems]);

  const stopHiding = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const hideIn = (ms: number) => {
    stopHiding();
    hideTimer.current = setTimeout(() => setToast(null), ms);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      const fresh = freshErrors(problems, seen.current, editing);
      seen.current = new Set(problems.map((p) => p.key));
      if (fresh.length > 0 && show === "notify") {
        setToast(fresh);
        hideIn(SHOW_FOR);
      }
      /* A notification about something that has since been fixed is a notification about nothing. */
      if (problems.every((p) => p.severity !== "error")) setToast(null);
    }, SETTLE);
    return () => clearTimeout(t);
    /* `signature` stands for `problems`; `editing` and `show` are read when it fires. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => stopHiding, []);

  /* Fixed or empty: the list has nothing to say, and an open tray over an empty board is a bug. */
  useEffect(() => {
    if (problems.length === 0) setOpen(false);
  }, [problems.length]);

  if (show === "off" || problems.length === 0) return null;

  const first = toast?.[0];
  /* Where it is, in a person's words: the kind of thing, and the page when there are several. */
  const where = (p: Problem) =>
    [p.type ? itemName(p.type) : "", p.page && pageName(p.page) ? pageName(p.page) : ""].filter(Boolean).join(" · ");
  const go = (p: Problem) => {
    setOpen(false);
    setToast(null);
    onShow(p);
  };

  return (
    <div className="dag-problems" data-dag-problems="" onPointerDown={(e) => e.stopPropagation()}>
      {open ? (
        <div className="dag-problems__tray" data-dag-problems-tray="" role="dialog" aria-label="Problems on this board">
          <header className="dag-problems__head">
            <span>Problems on this board</span>
            <button type="button" className="dag-icon" aria-label="Close the list" onClick={() => setOpen(false)}>
              <ChevronDown {...ICON} aria-hidden="true" />
            </button>
          </header>
          <ul className="dag-problems__list">
            {problems.map((p, i) => (
              <li key={`${p.key}@${p.line}#${i}`}>
                <button
                  type="button"
                  className={`dag-problems__row dag-problems__row--${p.severity}`}
                  data-dag-problems-row={p.code}
                  disabled={!p.item}
                  title={p.item ? "Show it" : undefined}
                  onClick={() => go(p)}
                >
                  <span className="dag-problems__msg">{p.words}</span>
                  {where(p) ? <span className="dag-problems__where">{where(p)}</span> : null}
                </button>
                {/* Under the row and not in it: a button inside a button is not a thing. */}
                {onRepair ? <RepairBox repair={repairOf?.(p) ?? null} code={p.code} onRepair={onRepair} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : first ? (
        <div
          className="dag-problems__toast"
          data-dag-problems-toast={first.code}
          role="status"
          aria-live="polite"
          onPointerEnter={stopHiding}
          onPointerLeave={() => hideIn(SHOW_FOR / 2)}
        >
          <AlertCircle {...ICON} aria-hidden="true" className="dag-problems__icon" />
          <span className="dag-problems__text">
            {where(first) ? <span className="dag-problems__code">{where(first)}</span> : null}
            <span className="dag-problems__msg">
              {first.words}
              {toast!.length > 1 ? ` (and ${toast!.length - 1} more)` : ""}
            </span>
          </span>
          {first.item ? (
            <button type="button" className="dag-problems__show" data-dag-problems-show="" onClick={() => go(first)}>
              Show
            </button>
          ) : null}
          <button
            type="button"
            className="dag-icon"
            data-dag-problems-dismiss=""
            aria-label="Dismiss"
            onClick={() => (stopHiding(), setToast(null))}
          >
            <X {...ICON} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={errors > 0 ? "dag-problems__pill dag-problems__pill--error" : "dag-problems__pill"}
        data-dag-problems-pill=""
        aria-expanded={open}
        title={open ? "Hide the list" : "Show every problem on this board"}
        onClick={() => (setToast(null), setOpen((v) => !v))}
      >
        <AlertCircle {...ICON} aria-hidden="true" />
        {errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : null}
        {errors > 0 && warnings > 0 ? " · " : null}
        {warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null}
      </button>
    </div>
  );
}

/**
 * What can be done about one problem, in the words of `planRepair`, under its row.
 *
 * The file's own problems — a settings block that is not YAML, a block of a kind nobody knows — have
 * no card to click and no panel field to change, and the dock used to say what was wrong and stop.
 * A relabel carries a select, led by the closest kind; everything else is one button. The answer
 * comes back as a sentence when it could not be done, and the row disappears when it was, because
 * the problem it stood for has.
 */
export function RepairBox({
  repair,
  code,
  onRepair,
}: {
  repair: Repair | null;
  code: string;
  onRepair(fix: Fix): Promise<string | null>;
}) {
  const [to, setTo] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  if (!repair) return null;

  const fix: Fix = repair.fix.kind === "retype" ? { ...repair.fix, to: to ?? repair.fix.to } : repair.fix;
  return (
    <div className="dag-problems__fix" data-dag-repair={code}>
      <p className="dag-problems__fix-words">{repair.words}</p>
      <div className="dag-problems__fix-row">
        {repair.choices ? (
          <select
            className="dag-select"
            data-dag-repair-kind=""
            aria-label="What it should be"
            value={fix.kind === "retype" ? fix.to : ""}
            onChange={(e) => setTo(e.target.value)}
          >
            {repair.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {itemName(c.value)}
                {c.suggested ? " (closest)" : ""}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="dag-problems__show"
          data-dag-repair-go=""
          onClick={() => void onRepair(fix).then(setSaid)}
        >
          {repair.action}
        </button>
      </div>
      {said ? (
        <p className="dag-problems__fix-words dag-problems__fix-words--bad" data-dag-repair-said="">
          {said}
        </p>
      ) : null}
    </div>
  );
}
