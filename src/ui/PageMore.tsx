import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, type KeyboardEvent as KeyEvent } from "react";

import { IconButton } from "@/ui/controls";
import { nextRow, useMenuCard } from "@/ui/menuCard";

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
  /** `from` is the `⋯` itself, for a row that opens a card hanging from it. */
  onSelect(from?: HTMLElement | null): void;
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
  const { open, setOpen, box, toggle, menu } = useMenuCard();

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
    const rows = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter(
      (b) => b.offsetParent !== null,
    );
    const next = nextRow(rows, e.key);
    if (next === null) return;
    e.preventDefault();
    rows[next]?.focus();
  };

  return (
    <div className={narrowOnly ? "dag-pagemore dag-pagemore--narrow" : "dag-pagemore"} ref={box}>
      <IconButton
        ref={toggle}
        className="dag-pagemore__toggle"
        data-dag-page-more=""
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal {...ICON} aria-hidden="true" />
      </IconButton>
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
                {/* A menu item, not a `Button`: a full-width row of the menu, moved by the arrow keys. */}
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
                    it.onSelect(toggle.current);
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
