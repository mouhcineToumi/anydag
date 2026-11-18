import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent, type ReactNode } from "react";

type Data = Record<`data-${string}`, string | undefined>;

/**
 * A menu that hangs from a button of the quiz form: *Add a question*'s four kinds, a question's kind
 * (#257). `PageMore`'s shape — a card under its button, shut by a press elsewhere or by Escape, the
 * focus handed back to the button — and the WAI menu pattern: rows with a `menuitem` role, walked
 * by the arrows, the checked one (or the first) taking the focus as it opens.
 *
 * **It is attached to its button, so nothing about it is a tooltip** drawn somewhere else (#257's
 * eighth problem). `numbered` lets `1`–`9` choose a row, as the kinds' tiles say.
 *
 * Escape is taken in the capture phase and stopped, so the innermost thing closes first: an open
 * field under it is not closed by the same key.
 */
export function Menu({
  label,
  button,
  buttonClass,
  buttonAttrs,
  menuClass,
  menuAttrs,
  disabled,
  numbered,
  children,
}: {
  /** The menu's accessible name. */
  label: string;
  button: ReactNode;
  buttonClass: string;
  buttonAttrs?: Data & { "aria-label"?: string };
  menuClass: string;
  menuAttrs?: Data;
  disabled?: boolean;
  numbered?: boolean;
  /**
   * The rows; `close` shuts the menu, as choosing one does, and hands the focus back to the button.
   * Never to nobody: a row that held the focus goes with the menu, and a key pressed before the
   * next thing takes it — the first letter of a new question's prompt — would be the page's, whose
   * space is the leader key.
   */
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("keydown", esc, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = menu.current;
    el?.scrollIntoView({ block: "nearest" });
    (el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? rows()[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const rows = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  const onKey = (e: KeyEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const all = rows();
    if (numbered && /^[1-9]$/.test(e.key)) {
      const row = all[Number(e.key) - 1];
      if (!row) return;
      e.preventDefault();
      row.click();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  };

  return (
    <div className="dag-quiz__menu-box" ref={box}>
      <button
        ref={toggle}
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        {...buttonAttrs}
      >
        {button}
      </button>
      {open ? (
        <div ref={menu} className={`dag-quiz__menu ${menuClass}`} role="menu" aria-label={label} onKeyDown={onKey} {...menuAttrs}>
          {children(() => {
            toggle.current?.focus();
            setOpen(false);
          })}
        </div>
      ) : null}
    </div>
  );
}
