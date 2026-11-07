import { Download, FileCode, FileDown, FileImage, FileSpreadsheet, FileText, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent } from "react";

import type { MoreItem } from "./PageMore";

/**
 * Export, at the end of the top bar.
 *
 * It lived behind the dock's `⋯`, ranked as rarely used there, and that hid it
 * too well: an export is the file you send when a link is not the answer, and it belongs where a
 * person looks for it. So it
 * is one button, on a board and on a note, and it left the `⋯` rather than being in both places: a
 * control in two places is two places to keep in step, which is the sidebar's rule.
 *
 * What it offers is the caller's — a board saves as SVG, PNG and its own file; a note as a PDF and its
 * own file — and this is only the button, the menu and the wait. **The menu is real buttons,
 * not a `<select>` laid over a label**, which is what the `⋯` needed for a menu row and what this does
 * not: a button that opens a card, closed the same two ways.
 *
 * `onExport` may take a moment — a PDF waits for every picture in the note to arrive — so the button
 * says so while it does, and a failure is said under it rather than in an `alert()` that blocks the
 * page and that the suite cannot read.
 */

export interface ExportOption<V extends string> {
  value: V;
  label: string;
  /** What the file is for, in a few words — the tooltip, which is where a design system puts a name. */
  hint: string;
  icon: LucideIcon;
}

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * A board's three, exactly as the `⋯` offered them. The PNG says its scale, because the scale is a
 * setting and a caption stating a constant is a lie the moment the constant is a preference — which is
 * why this takes the scale rather than reading it: the caller holds `useSettings()` already.
 */
export const boardExports = (scale: number): ExportOption<"svg" | "png" | "md">[] => [
  { value: "svg", label: "Board as SVG", hint: "A picture that stays sharp at any size, fonts included", icon: FileImage },
  { value: "png", label: `Board as PNG (${scale}×)`, hint: `A picture at ${scale}× its size on the board`, icon: FileImage },
  {
    value: "md",
    label: "Board file (.board.md)",
    hint: "The board itself, which imports back with its links intact. With pictures or files, it comes as a .zip",
    icon: FileCode,
  },
];

/**
 * A note's two: a PDF, through the browser's own print — `src/export/print.ts` says why —
 * and the file itself, which is Markdown any editor opens.
 */
export const NOTE_EXPORTS: ExportOption<"pdf" | "md">[] = [
  { value: "pdf", label: "Note as PDF", hint: "Opens the print dialog: choose Save as PDF", icon: FileDown },
  { value: "md", label: "Note file (.note.md)", hint: "The note itself, as Markdown. With pictures or files, it comes as a .zip", icon: FileText },
];

/**
 * A quiz's one export: the file, with its id sealed in, so a quiz saved to disk and
 * imported again finds the practice history kept against that id — a board's rule, and a stronger
 * reason, because a quiz's id is also the key to somebody's Mistakes.
 */
export const QUIZ_EXPORTS: ExportOption<"md">[] = [
  { value: "md", label: "Quiz file (.quiz.md)", hint: "The quiz itself, which imports back with its history", icon: FileText },
];

/**
 * A table's two: the tab showing, as CSV — every row in its sort order, a filter being a
 * view and not a file — and the table itself, with its id sealed in as a board's is.
 */
export const TABLE_EXPORTS: ExportOption<"csv" | "md">[] = [
  { value: "csv", label: "Tab as CSV", hint: "This tab's rows, for a spreadsheet: sorted, not filtered", icon: FileSpreadsheet },
  { value: "md", label: "Table file (.table.md)", hint: "The table itself, every tab, which imports back with its links intact", icon: FileText },
];

/**
 * The same choices as rows of the top bar's `⋯`, for a narrow window: the bar folds under 720px and
 * the button is not drawn there, so the menu carries what it would have offered. On a wider window
 * these rows are hidden and the button is the one at the top right.
 */
export function exportRows<V extends string>(options: ExportOption<V>[], onExport: (value: V) => void | Promise<void>): MoreItem[] {
  return options.map((o, i) => ({
    key: `export-${o.value}`,
    label: o.label,
    icon: o.icon,
    title: o.hint,
    narrow: true,
    split: i === 0,
    /* A failure here has nowhere to be said but the console — so it is handled, and the button's
       wording is kept for the wide window that has one. */
    onSelect: () => void Promise.resolve(onExport(o.value)).catch(() => undefined),
  }));
}

export function ExportButton<V extends string>({
  what,
  options,
  onExport,
}: {
  /** "board", "note" or "quiz": the button's tooltip names the thing it saves. */
  what: string;
  options: ExportOption<V>[];
  onExport(value: V): void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /* Shut by a press elsewhere or by Escape: with focus on a
     button in here the board's own Escape chain cannot see the key, and one Escape lets go of the
     innermost thing. Focus goes back to the button, so the next key reaches something. */
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

  /* The first choice takes the focus when the menu opens, so the keyboard is already in it. */
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  /* A failure is said until the next thing is tried, and not for ever after. */
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => setFailed(null), 8000);
    return () => clearTimeout(t);
  }, [failed]);

  const run = async (value: V) => {
    setOpen(false);
    setFailed(null);
    setBusy(true);
    try {
      await onExport(value);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /* Up and down walk the choices, the WAI menu pattern; Tab leaves, as it does from any card here. */
  const onMenuKey = (e: KeyEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="dag-export" ref={box}>
      <button
        ref={toggle}
        type="button"
        className="dag-export__toggle"
        data-dag-export=""
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={busy}
        title={`Export: save this ${what} as a file`}
        onClick={() => setOpen((v) => !v)}
      >
        <Download {...ICON} aria-hidden="true" />
        <span className="dag-export__word">{busy ? "Exporting…" : "Export"}</span>
      </button>
      {open ? (
        <div className="dag-export__menu" data-dag-export-menu="" role="menu" aria-label={`Export this ${what}`} ref={menu} onKeyDown={onMenuKey}>
          {options.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                className="dag-more__item"
                data-dag-export-as={o.value}
                title={o.hint}
                onClick={() => void run(o.value)}
              >
                <Icon {...ICON} aria-hidden="true" />
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {failed ? (
        <p className="dag-export__failed" data-dag-export-failed="" role="alert">
          Couldn't export: {failed}
        </p>
      ) : null}
    </div>
  );
}
