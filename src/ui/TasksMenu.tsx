import { Check, Square, SquareCheck } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { menuWithin, type Spot } from "@/calendar/menu";

/**
 * The Tasks page's one menu: a status to set, a priority, a project, how to order and group the
 * list, what to filter by. The calendar's item menu (`ItemMenu` in `Calendar.tsx`) is the pattern —
 * `role="menu"`, `dag-more__item` rows walked by the arrows, the popover layer, Escape or a press
 * elsewhere to shut it, and `menuWithin` to keep it in the window — written once here because the
 * page opens a dozen of them. **Every row carries its icon**, the one the list draws for that value
 * (#311's decision), so a menu reads at a glance.
 *
 * Portalled to `<body>` and placed in the window's coordinates, so a menu opened from a row near the
 * foot of a scrolled list is not cut off by it.
 */

export type MenuRow =
  | {
      kind?: "item";
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      /** Drawn at the end: a key that does the same (`1`), or a count. */
      hint?: ReactNode;
      /** A tick at the end, for the one in use. */
      checked?: boolean;
      /** A box before the label, for a list of values any number of which can be on. */
      box?: boolean;
      onPick(): void;
      /** Keep the menu open after the pick: a box ticked among several. */
      stay?: boolean;
      data?: Record<`data-${string}`, string>;
      disabled?: boolean;
    }
  | { kind: "heading"; key: string; label: string }
  | { kind: "rule"; key: string };

type Item = Exclude<MenuRow, { kind: "heading" | "rule" }>;

export function TasksMenu({
  at,
  rows,
  label,
  onClose,
  footer,
  data,
}: {
  /** Where its top-left corner goes, in the window. */
  at: Spot;
  rows: MenuRow[];
  /** What a screen reader hears it called. */
  label: string;
  onClose(): void;
  /** A line under the rows: the lock's sentence. */
  footer?: ReactNode;
  data?: Record<`data-${string}`, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(menuWithin(at, el.getBoundingClientRect(), { width: innerWidth, height: innerHeight }));
    (
      el.querySelector<HTMLElement>("[role^=menuitem][aria-checked=true]") ?? el.querySelector<HTMLElement>("[role^=menuitem]")
    )?.focus();
  }, [at]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [onClose]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    /* Every key aimed at the menu stops at its edge: the list's own keys must not hear a 1 meant here. */
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      return onClose();
    }
    /* A row's hint is the key that picks it: `1` in the status menu is To do, as it is after `S`. */
    const hinted = rows.find((r): r is Item => r.kind !== "heading" && r.kind !== "rule" && !r.disabled && r.hint === e.key);
    if (hinted && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      hinted.onPick();
      if (!hinted.stay) onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? []);
    const now = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (now + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="dag-tasks-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
      {...data}
    >
      {rows.map((row) => {
        if (row.kind === "heading")
          return (
            <p key={row.key} className="dag-tasks-menu__heading" role="presentation">
              {row.label}
            </p>
          );
        if (row.kind === "rule") return <hr key={row.key} className="dag-tasks-menu__rule" />;
        const role = row.box ? "menuitemcheckbox" : row.checked !== undefined ? "menuitemradio" : "menuitem";
        return (
          <button
            key={row.key}
            type="button"
            role={role}
            aria-checked={row.box || row.checked !== undefined ? !!row.checked : undefined}
            className="dag-more__item dag-tasks-menu__item"
            disabled={row.disabled}
            {...row.data}
            onClick={() => {
              row.onPick();
              if (!row.stay) onClose();
            }}
          >
            {row.box ? (
              <span className="dag-tasks-menu__box" data-on={row.checked ? "" : undefined} aria-hidden="true">
                {row.checked ? <SquareCheck size={16} strokeWidth={2} /> : <Square size={16} strokeWidth={2} />}
              </span>
            ) : null}
            {row.icon ? <span className="dag-tasks-menu__icon">{row.icon}</span> : null}
            <span className="dag-tasks-menu__label">{row.label}</span>
            {row.hint !== undefined ? <kbd className="dag-tasks-kbd dag-tasks-menu__hint">{row.hint}</kbd> : null}
            {!row.box && row.checked ? (
              <Check size={14} strokeWidth={2} className="dag-tasks-menu__tick" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
      {footer ? <p className="dag-tasks-menu__foot">{footer}</p> : null}
    </div>,
    document.body,
  );
}

/** Where a menu opened from a control goes: under it, its left edge on the control's. */
export const under = (el: Element): Spot => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};
