import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent } from "react";

/**
 * One row of the top bar's `⋯`.
 *
 * `hook` is the attribute the control had before it moved in here — `data-dag-note-make-task` was a
 * button in the bar — so a check that pressed it presses the same element one menu deeper. `narrow`
 * marks a row that is only here on a narrow window, where the bar folds and the control it stands for is not
 * drawn: an export, whose button the bar keeps on a wider window for that reason.
 */
export interface MoreItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect(): void;
  hook?: string;
  title?: string;
  narrow?: boolean;
  disabled?: boolean;
  /** A rule above this row: the menu is grouped by what the rows do to the file. */
  split?: boolean;
}

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The top bar's overflow: what a page can do to its file that is not the one thing it is
 * for. A note's *Make it a task* and *Make it an event*, a table's *Import CSV*, and on every file
 * Rename and *Show in the sidebar* — each was a labelled button in a 48px bar that also had to hold
 * the file's name, which is why a 929px window cut the name to three letters.
 *
 * Export's shape: a button that opens a card under it, shut by a press elsewhere or by
 * Escape, the focus handed back to the button. Real buttons with `role="menuitem"`, walked by the
 * arrows, which is the WAI menu pattern the sidebar's menus follow.
 */
export function PageMore({ items }: { items: MoreItem[] }) {
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
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    /* The first row a person can see: a `narrow` one is `display: none` on a wide window. */
    const rows = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    rows.find((b) => b.offsetParent !== null)?.focus();
  }, [open]);

  if (items.length === 0) return null;
  /* Nothing but phone rows means nothing to show on a wide window, where the button is then hidden. */
  const narrowOnly = items.every((i) => i.narrow);

  const onMenuKey = (e: KeyEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const rows = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter(
      (b) => b.offsetParent !== null,
    );
    if (rows.length === 0) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return (
    <div className={narrowOnly ? "dag-pagemore dag-pagemore--narrow" : "dag-pagemore"} ref={box}>
      <button
        ref={toggle}
        type="button"
        className="dag-icon dag-pagemore__toggle"
        data-dag-page-more=""
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        title="More"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal {...ICON} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="dag-pagemore__menu"
          data-dag-page-more-menu=""
          role="menu"
          aria-label="More"
          ref={menu}
          onKeyDown={onMenuKey}
        >
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.key} className={it.narrow ? "dag-pagemore__group dag-pagemore__group--narrow" : "dag-pagemore__group"}>
                {it.split ? <hr className="dag-pagemore__rule" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className="dag-more__item"
                  data-dag-page-more-item={it.key}
                  {...(it.hook ? { [it.hook]: "" } : {})}
                  title={it.title}
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                >
                  <Icon {...ICON} aria-hidden="true" />
                  <span>{it.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
