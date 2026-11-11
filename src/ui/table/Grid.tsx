import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpNarrowWide,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useIndex, titleOf } from "@/refs/useIndex";
import { parseCsv } from "@/table/csv";
import { COLUMN_TYPES, cellSource, type ColumnType, type Tab } from "@/table/parse";
import { optionsOf, readDate, viewRows } from "@/table/values";
import {
  addColumn,
  addRow,
  moveColumn,
  moveRow,
  removeColumn,
  removeRow,
  setCell,
  setColumn,
  setRowHeight,
  setTab,
} from "@/table/write";
import { startDrag } from "@/ui/pointerDrag";
import { COLUMN_ICON, COLUMN_LABEL, CellView, colStyle, keysOf, optionHue } from "@/view/TableRead";
import { hueVars } from "@/render/hue";

import { ProblemList } from "./ProblemList";
import type { Fix, Problem } from "./problems";

/**
 * A tab's grid, editable.
 *
 * **Every gesture is one writer from `src/table/write.ts`**, handed to the page's `edit`, which
 * gives everything that has no id one first (`stampTable`) and turns the grid's positions into ids
 * (`At`) — so a cell set rewrites that cell and a row dragged moves that line, and the other writer's
 * edit to any other row survives. Nothing here spells the format.
 *
 * **Positions are the view's, and the view is the file's**: `viewRows` — the tab's filter kept, in
 * its sort's order — says which stored row a line on screen is. Dragging a row is refused while a
 * sort is showing, because under a sort a row's place is not its own.
 *
 * The keys are a spreadsheet's: the arrows and Tab move, Enter, F2 or typing edit, Enter and Tab
 * commit and move on, Escape takes the draft back, Delete clears, space ticks a checkbox. A paste of
 * several lines and tabs fills the cells from the one selected, and adds the rows it needs. **A key
 * the grid takes goes no further**: the page's `space O` listens on the window, and a space that
 * ticked a box followed by an `o` typed into the next cell would otherwise open the search.
 */

/** A grid's positions turned into the ids a writer takes, over the text the edit is applied to. */
export interface At {
  tab: string;
  /** A stored row's id, by its place in the file. */
  row(stored: number): string;
  /** A column's id, by its place. */
  col(index: number): string;
}

/** Apply one writer — `key` coalesces a run of edits into one undo, as the board's typing does. */
export type Edit = (f: (text: string, at: At) => string, key?: string) => void;

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Where a cell is: `r` in the view, `c` among the columns. */
interface Pos {
  r: number;
  c: number;
}

type Menu = { kind: "col"; c: number; x: number; y: number } | { kind: "row"; r: number; x: number; y: number };

/** The file's problems for this tab, as the grid draws them: marks on columns and rows, a title on a cell. */
export interface GridProblems {
  list: readonly Problem[];
  /** The tab's place in the file, which a problem's `where` names. */
  tab: number;
  onFix(p: Problem, f: Fix): void;
}

/** A card of problems opened from a mark. */
interface Flagged {
  x: number;
  y: number;
  problems: Problem[];
}

/** The narrowest a column is dragged to, which is what `setColumn` floors a width at too. */
const MIN_W = 40;
const MIN_H = 24;

export function Grid({
  tab,
  edit,
  mark = null,
  readOnly = false,
  onRefused,
  problems,
}: {
  tab: Tab;
  edit: Edit;
  mark?: number | null;
  readOnly?: boolean;
  problems?: GridProblems;
  /** A key or a press that would have edited a read-only grid — the lock's notice. */
  onRefused?(): void;
}) {
  const rows = useMemo(() => viewRows(tab), [tab]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const options = useMemo(() => tab.columns.map((c, i) => (c.type === "select" ? optionsOf(c, tab.rows, i) : [])), [tab]);
  const sorted = tab.sort.length > 0;
  const [active, setActive] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<(Pos & { draft: string }) | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [flagged, setFlagged] = useState<Flagged | null>(null);
  /* Who has a problem, by place: a column's by its index, a row's — and its cells' — by its stored one. */
  const flags = useMemo(() => {
    const columns = new Map<number, Problem[]>();
    const rows = new Map<number, Problem[]>();
    const cells = new Map<string, Problem>();
    const add = <K,>(m: Map<K, Problem[]>, k: K, p: Problem) => m.set(k, [...(m.get(k) ?? []), p]);
    for (const p of problems?.list ?? []) {
      const w = p.where;
      if (w.kind === "file" || w.tab !== problems?.tab) continue;
      if (w.kind === "column") add(columns, w.column, p);
      else if (w.kind === "row") add(rows, w.row, p);
      else if (w.kind === "cell") {
        add(rows, w.row, p);
        cells.set(`${w.row}:${w.column}`, p);
      }
    }
    return { columns, rows, cells };
  }, [problems]);
  const flag = (list: Problem[], name: string) => (
    <button
      type="button"
      className="dag-grid__flag"
      data-dag-grid-flag={name}
      data-severity={list.some((p) => p.severity === "error") ? "error" : "warning"}
      aria-label={`${list.length} ${list.length === 1 ? "problem" : "problems"}: ${list[0]!.words}`}
      title={list.map((p) => p.words).join("\n")}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const box = e.currentTarget.getBoundingClientRect();
        setFlagged((f) => (f ? null : { x: box.left, y: box.bottom, problems: list }));
      }}
    >
      <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
  /* A row just added, by its stored place, to be selected once it is drawn. */
  const [pending, setPending] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);

  const cols = tab.columns.length;
  const height = rows.length;
  const colKeys = useMemo(() => keysOf(tab.columns), [tab]);
  const rowKeys = useMemo(() => keysOf(tab.rows), [tab]);

  /* A selection past the end — a row filtered out, a column removed — comes back inside. */
  useEffect(() => {
    setActive((a) =>
      a && (a.r >= height || a.c >= cols)
        ? height && cols
          ? { r: Math.min(a.r, height - 1), c: Math.min(a.c, cols - 1) }
          : null
        : a,
    );
  }, [height, cols]);

  useEffect(() => {
    if (pending === null) return;
    const r = rows.findIndex((x) => x.index === pending);
    if (r === -1) return;
    setPending(null);
    setActive({ r, c: 0 });
    wrap.current?.focus();
  }, [pending, rows]);

  /* A row a reference or a search result named, by its stored place: selected and brought into
     view. Keyed on the place alone, so a later edit does not pull the selection back to it. */
  useEffect(() => {
    if (mark === null) return;
    const r = rowsRef.current.findIndex((x) => x.index === mark);
    if (r !== -1) setActive({ r, c: 0 });
  }, [mark]);

  useLayoutEffect(() => {
    if (!active) return;
    table.current
      ?.querySelector(`[data-dag-grid-at="${active.r}:${active.c}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const storedOf = (r: number): number => rows[r]!.index;

  const setValue = useCallback(
    (r: number, c: number, value: string) => {
      const stored = rows[r]?.index;
      if (stored === undefined) return;
      const col = tab.columns[c]!;
      const declared = col.type === "select" && col.options?.length ? col.options : null;
      edit((t, at) => {
        let out = setCell(t, at.tab, at.row(stored), at.col(c), value);
        /* A new option typed into a select with declared ones joins the list, so it reads. */
        if (declared && value.trim() && !declared.includes(value.trim()))
          out = setColumn(out, at.tab, at.col(c), { options: [...declared, value.trim()] });
        return out;
      }, `cell:${tab.id}:${stored}:${c}`);
    },
    [rows, tab, edit],
  );

  const toggle = (r: number, c: number) => {
    const text = rows[r]?.row.cells[c] ?? "";
    const on = /^\s*\[[xX]\]\s*$|^\s*(x|true|yes|1|✓|✔)\s*$/i.test(text);
    setValue(r, c, on ? "[ ]" : "[x]");
  };

  const addRowAt = (where?: { after?: number; before?: number }) => {
    edit((t, at) => {
      const opts =
        where?.after !== undefined
          ? { after: at.row(where.after) }
          : where?.before !== undefined
            ? { before: at.row(where.before) }
            : {};
      return addRow(t, at.tab, opts).text;
    });
    setPending(where?.after !== undefined ? where.after + 1 : where?.before !== undefined ? where.before : tab.rows.length);
  };

  const addColumnAt = (at_: { after?: number; before?: number } = {}) =>
    edit((t, at) => {
      const n = tab.columns.length + 1;
      const where =
        at_.after !== undefined ? { after: at.col(at_.after) } : at_.before !== undefined ? { before: at.col(at_.before) } : {};
      return addColumn(t, at.tab, { name: `Column ${n}`, ...where }).text;
    });

  const move = (dr: number, dc: number) => {
    if (!height || !cols) return;
    setActive((a) => {
      const at = a ?? { r: 0, c: 0 };
      return { r: Math.max(0, Math.min(height - 1, at.r + dr)), c: Math.max(0, Math.min(cols - 1, at.c + dc)) };
    });
  };

  const startEdit = (p: Pos, draft?: string) => {
    if (readOnly) return;
    const col = tab.columns[p.c];
    if (!col) return;
    if (col.type === "checkbox") return toggle(p.r, p.c);
    setActive(p);
    setEditing({ ...p, draft: draft ?? rows[p.r]?.row.cells[p.c] ?? "" });
  };

  const finish = (value: string | null, then: "down" | "right" | "left" | "stay") => {
    const e = editing;
    setEditing(null);
    if (e && value !== null && value !== (rows[e.r]?.row.cells[e.c] ?? "")) setValue(e.r, e.c, value);
    if (then === "down") move(1, 0);
    else if (then === "right") move(0, 1);
    else if (then === "left") move(0, -1);
    wrap.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || menu) return;
    if (e.target !== wrap.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const a = active;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        return move(-1, 0);
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        return move(1, 0);
      case "ArrowLeft":
        e.preventDefault();
        e.stopPropagation();
        return move(0, -1);
      case "ArrowRight":
        e.preventDefault();
        e.stopPropagation();
        return move(0, 1);
      case "Tab":
        e.preventDefault();
        e.stopPropagation();
        return move(0, e.shiftKey ? -1 : 1);
      case "Home":
        e.preventDefault();
        e.stopPropagation();
        return setActive((x) => (x ? { r: mod ? 0 : x.r, c: 0 } : x));
      case "End":
        e.preventDefault();
        e.stopPropagation();
        return setActive((x) => (x ? { r: mod ? height - 1 : x.r, c: cols - 1 } : x));
      case "Escape":
        if (a) {
          e.preventDefault();
          e.stopPropagation();
          setActive(null);
        }
        return;
      default:
        break;
    }
    if (!a) return;
    if (readOnly) {
      /* What would have edited the cell is answered rather than ignored, and kept from the page. */
      if (
        onRefused &&
        (e.key === "Enter" ||
          e.key === "F2" ||
          e.key === "Delete" ||
          e.key === "Backspace" ||
          (e.key.length === 1 && !mod && !e.altKey))
      ) {
        e.preventDefault();
        e.stopPropagation();
        onRefused();
      }
      return;
    }
    const col = tab.columns[a.c];
    if (!col) return;
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      return startEdit(a);
    }
    if (e.key === " " && col.type === "checkbox") {
      e.preventDefault();
      e.stopPropagation();
      return toggle(a.r, a.c);
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      return setValue(a.r, a.c, col.type === "checkbox" ? "[ ]" : "");
    }
    if (e.key.length === 1 && !mod && !e.altKey && col.type !== "checkbox") {
      e.preventDefault();
      e.stopPropagation();
      return startEdit(a, col.type === "date" ? undefined : e.key);
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !active || e.target !== wrap.current) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", rows[active.r]?.row.cells[active.c] ?? "");
  };

  /* Several lines and tabs fill the cells from the one selected, adding the rows they need — one
     edit, so one undo takes the whole paste back. */
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !active || readOnly || e.target !== wrap.current) return;
    const raw = e.clipboardData.getData("text/plain");
    if (!raw) return;
    e.preventDefault();
    const grid = raw.includes("\t") || raw.includes("\n") ? parseCsv(raw, raw.includes("\t") ? "\t" : undefined) : [[raw]];
    const start = active;
    const stored = rows.map((x) => x.index);
    edit((t, at) => {
      let out = t;
      grid.forEach((line, i) => {
        const r = start.r + i;
        let id: string;
        if (r < stored.length) id = at.row(stored[r]!);
        else {
          const made = addRow(out, at.tab);
          out = made.text;
          id = made.id;
        }
        line.forEach((value, j) => {
          const c = start.c + j;
          if (c < cols) out = setCell(out, at.tab, id, at.col(c), value);
        });
      });
      return out;
    });
  };

  /* -- resizing and reordering, painted while the pointer moves and written once it lets go -- */

  const resizeColumn = (c: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const colEl = table.current?.querySelectorAll<HTMLTableColElement>("col[data-dag-grid-colw]")[c];
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!colEl || !th) return;
    const from = th.getBoundingClientRect().width;
    const sx = e.clientX;
    let w = from;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(MIN_W, Math.round(from + ev.clientX - sx));
      colEl.style.width = `${w}px`;
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      if (Math.abs(w - from) >= 2) edit((t, at) => setColumn(t, at.tab, at.col(c), { w }));
      else colEl.style.width = "";
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const resizeRow = (r: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const tr = (e.currentTarget as HTMLElement).closest("tr");
    if (!tr) return;
    const from = tr.getBoundingClientRect().height;
    const sy = e.clientY;
    let h = from;
    const stored = storedOf(r);
    const onMove = (ev: PointerEvent) => {
      h = Math.max(MIN_H, Math.round(from + ev.clientY - sy));
      tr.style.height = `${h}px`;
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      if (Math.abs(h - from) >= 2) edit((t, at) => setRowHeight(t, at.tab, at.row(stored), h));
      else tr.style.height = "";
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const clearDrops = () => {
    for (const el of table.current?.querySelectorAll<HTMLElement>("[data-dag-grid-drop]") ?? []) delete el.dataset.dagGridDrop;
  };

  /* A column's header dragged past its neighbours: the header under the pointer, and which half. */
  const dragColumn = (c: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (readOnly || (e.target as HTMLElement).closest("[data-dag-grid-resize]")) return;
    let before: number | null | undefined;
    const x0 = e.clientX;
    const y0 = e.clientY;
    startDrag(e, {
      onMove(ev) {
        clearDrops();
        const th = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-dag-grid-col-index]");
        if (!th) return (before = undefined);
        const at = Number(th.dataset.dagGridColIndex);
        const box = th.getBoundingClientRect();
        const right = ev.clientX > box.left + box.width / 2;
        th.dataset.dagGridDrop = right ? "after" : "before";
        before = right ? (at + 1 < cols ? at + 1 : null) : at;
      },
      onDrop() {
        if (before === undefined || before === c || before === c + 1) return;
        edit((t, at) => moveColumn(t, at.tab, at.col(c), before === null ? null : at.col(before!)));
      },
      onClick() {
        setMenu({ kind: "col", c, x: x0, y: y0 });
      },
      onEnd: clearDrops,
    });
  };

  const dragRow = (r: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (readOnly) return;
    const stored = storedOf(r);
    let before: number | null | undefined;
    const x0 = e.clientX;
    const y0 = e.clientY;
    startDrag(e, {
      onMove(ev) {
        clearDrops();
        if (sorted) return;
        const tr = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-dag-grid-row-index]");
        if (!tr) return (before = undefined);
        const at = Number(tr.dataset.dagGridRowIndex);
        const box = tr.getBoundingClientRect();
        const below = ev.clientY > box.top + box.height / 2;
        tr.dataset.dagGridDrop = below ? "after" : "before";
        const next = below ? rows[at + 1] : rows[at];
        before = next ? next.index : null;
      },
      onDrop() {
        if (sorted || before === undefined || before === stored) return;
        edit((t, at) => moveRow(t, at.tab, at.row(stored), before === null ? null : at.row(before!)));
      },
      onClick() {
        setMenu({ kind: "row", r, x: x0, y: y0 });
      },
      onEnd: clearDrops,
    });
  };

  if (cols === 0)
    return (
      <div className="dag-grid-wrap dag-grid-wrap--empty">
        <p className="dag-grid__empty">This tab has no columns yet.</p>
        {readOnly ? null : (
          <button type="button" className="dag-grid__add" data-dag-grid-add-col="" onClick={() => addColumnAt()}>
            <Plus {...ICON} aria-hidden="true" /> Add a column
          </button>
        )}
      </div>
    );

  return (
    <div
      ref={wrap}
      className="dag-grid-wrap"
      tabIndex={0}
      role="grid"
      aria-rowcount={height + 1}
      aria-colcount={cols}
      data-dag-grid-wrap=""
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
    >
      <table ref={table} className="dag-grid dag-grid--edit" data-dag-grid={tab.id ?? ""} role="presentation">
        <colgroup>
          <col className="dag-grid__col dag-grid__col--gutter" />
          {tab.columns.map((c, i) => (
            <col
              key={colKeys[i]}
              data-dag-grid-colw=""
              className={`dag-grid__col dag-grid__col--${c.type}`}
              style={colStyle(c)}
            />
          ))}
          {readOnly ? null : <col className="dag-grid__col dag-grid__col--add" />}
        </colgroup>
        <thead>
          <tr>
            <th className="dag-grid__corner" aria-hidden="true" />
            {tab.columns.map((c, i) => {
              const Icon = COLUMN_ICON[c.type];
              const by = tab.sort.find((s) => s.column === c.id);
              return (
                <th
                  key={colKeys[i]}
                  className="dag-grid__head"
                  scope="col"
                  data-dag-grid-col={c.id ?? ""}
                  data-dag-grid-col-index={i}
                  title={`${c.name} — ${COLUMN_LABEL[c.type]}${readOnly ? "" : ". Click for its menu, drag to move it"}`}
                  onPointerDown={dragColumn(i)}
                >
                  <span className="dag-grid__head-in">
                    <Icon size={12} strokeWidth={2} aria-hidden="true" />
                    <span className="dag-grid__name">{c.name || " "}</span>
                    {flags.columns.has(i) ? flag(flags.columns.get(i)!, "column") : null}
                    {by ? (
                      by.desc ? (
                        <ArrowDownWideNarrow
                          size={12}
                          strokeWidth={2}
                          aria-label="Sorted descending"
                          className="dag-grid__sorted"
                        />
                      ) : (
                        <ArrowUpNarrowWide size={12} strokeWidth={2} aria-label="Sorted ascending" className="dag-grid__sorted" />
                      )
                    ) : null}
                  </span>
                  {readOnly ? null : (
                    <span
                      className="dag-grid__resize"
                      data-dag-grid-resize={i}
                      title="Drag to resize; double-click for its own width"
                      onPointerDown={resizeColumn(i)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        edit((t, at) => setColumn(t, at.tab, at.col(i), { w: null }));
                      }}
                    />
                  )}
                </th>
              );
            })}
            {readOnly ? null : (
              <th className="dag-grid__head dag-grid__head--add">
                <button
                  type="button"
                  className="dag-grid__plus"
                  data-dag-grid-add-col=""
                  title="Add a column"
                  aria-label="Add a column"
                  onClick={() => addColumnAt()}
                >
                  <Plus {...ICON} aria-hidden="true" />
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, index }, r) => (
            <tr
              key={rowKeys[index]}
              data-dag-grid-row={row.id ?? ""}
              data-dag-grid-row-index={r}
              data-dag-grid-marked={mark === index ? "" : undefined}
              style={row.h ? { height: `${row.h}px` } : undefined}
            >
              <th
                className="dag-grid__gutter"
                scope="row"
                title={
                  readOnly
                    ? undefined
                    : sorted
                      ? "Click for this row's menu. Clear the sort to drag rows."
                      : "Click for this row's menu, drag to move it"
                }
                onPointerDown={dragRow(r)}
              >
                <span className="dag-grid__num">{index + 1}</span>
                {flags.rows.has(index) ? flag(flags.rows.get(index)!, "row") : null}
                {readOnly ? null : <GripVertical size={12} strokeWidth={2} className="dag-grid__grip" aria-hidden="true" />}
                {readOnly ? null : (
                  <span
                    className="dag-grid__rowresize"
                    data-dag-grid-rowresize={r}
                    title="Drag to change its height"
                    onPointerDown={resizeRow(r)}
                  />
                )}
              </th>
              {tab.columns.map((c, i) => {
                const on = active?.r === r && active.c === i;
                const isEditing = editing?.r === r && editing.c === i;
                return (
                  <td
                    key={colKeys[i]}
                    className={`dag-grid__cell dag-grid__cell--${c.type}`}
                    data-dag-grid-at={`${r}:${i}`}
                    title={flags.cells.get(`${index}:${i}`)?.words}
                    data-dag-grid-active={on ? "" : undefined}
                    data-dag-grid-editing={isEditing ? "" : undefined}
                    aria-selected={on}
                    onPointerDown={(e) => {
                      if (isEditing || e.button !== 0) return;
                      /* A tick's box toggles on a press of its own; anywhere else in the cell selects it. */
                      if (c.type === "checkbox" && (e.target as HTMLElement).closest(".dag-grid__check") && readOnly)
                        onRefused?.();
                      if (c.type === "checkbox" && (e.target as HTMLElement).closest(".dag-grid__check") && !readOnly) {
                        e.preventDefault();
                        setActive({ r, c: i });
                        toggle(r, i);
                        wrap.current?.focus();
                        return;
                      }
                      if ((e.target as HTMLElement).closest("a")) return;
                      e.preventDefault();
                      if (on && !readOnly && c.type !== "checkbox") return startEdit({ r, c: i });
                      setActive({ r, c: i });
                      wrap.current?.focus();
                    }}
                    onDoubleClick={() => startEdit({ r, c: i })}
                  >
                    {isEditing ? (
                      <CellEditor
                        type={c.type}
                        initial={editing.draft}
                        stored={row.cells[i] ?? ""}
                        options={options[i]!}
                        onDone={(value, then) => finish(value, then)}
                      />
                    ) : (
                      <CellView type={c.type} text={row.cells[i] ?? ""} options={options[i]!} />
                    )}
                  </td>
                );
              })}
              {readOnly ? null : <td className="dag-grid__cell dag-grid__cell--add" aria-hidden="true" />}
            </tr>
          ))}
        </tbody>
      </table>
      {readOnly ? null : (
        <button type="button" className="dag-grid__add" data-dag-grid-add-row="" onClick={() => addRowAt()}>
          <Plus {...ICON} aria-hidden="true" /> New row
        </button>
      )}
      {flagged ? (
        <Pop at={flagged} onClose={() => setFlagged(null)} label="Problems">
          <ProblemList
            problems={flagged.problems}
            disabled={readOnly}
            onFix={(p, f) => {
              setFlagged(null);
              problems?.onFix(p, f);
            }}
          />
        </Pop>
      ) : null}
      {menu?.kind === "col" && tab.columns[menu.c] ? (
        <ColumnMenu
          key={`col-${menu.c}-${tab.columns[menu.c]!.id}`}
          tab={tab}
          c={menu.c}
          at={menu}
          edit={edit}
          onInsert={(where) => addColumnAt(where)}
          onClose={() => {
            setMenu(null);
            wrap.current?.focus();
          }}
        />
      ) : null}
      {menu?.kind === "row" && rows[menu.r] ? (
        <RowMenu
          at={menu}
          onInsert={(where) => addRowAt(where === "above" ? { before: storedOf(menu.r) } : { after: storedOf(menu.r) })}
          onDelete={() => {
            const stored = storedOf(menu.r);
            edit((t, at) => removeRow(t, at.tab, at.row(stored)));
          }}
          onClose={() => {
            setMenu(null);
            wrap.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/* -- editing one cell ---------------------------------------------------------------------------- */

type Then = "down" | "right" | "left" | "stay";

/**
 * The input over one cell while it is edited: a field by the column's type. It holds its own draft
 * and hands back what to write — or `null`, for Escape — and where the selection goes next.
 */
function CellEditor({
  type,
  initial,
  stored,
  options,
  onDone,
}: {
  type: ColumnType;
  initial: string;
  /** What the cell holds in the file, which a select's list is filtered against. */
  stored: string;
  options: readonly string[];
  onDone(value: string | null, then: Then): void;
}) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    /* Typing into a cell replaces it, as a spreadsheet does; Enter or a double-click keeps it and puts the caret at its end. */
    if (el.setSelectionRange && type !== "date") {
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {
        /* A date input has no selection to set. */
      }
    }
  }, [type]);

  const end = (value: string | null, then: Then) => {
    if (done.current) return;
    done.current = true;
    onDone(value, then);
  };

  const keys = (e: KeyboardEvent<HTMLElement>, value: string = draft) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      end(null, "stay");
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      end(value, "down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      end(value, e.shiftKey ? "left" : "right");
    }
  };

  if (type === "select")
    return (
      <SelectEditor
        draft={draft}
        setDraft={setDraft}
        stored={stored}
        options={options}
        inputRef={ref}
        onKeys={keys}
        onEnd={end}
      />
    );
  if (type === "link") return <LinkEditor draft={draft} setDraft={setDraft} inputRef={ref} onKeys={keys} onEnd={end} />;
  if (type === "date")
    return (
      <input
        ref={ref}
        type="date"
        className="dag-grid__input"
        data-dag-grid-input=""
        value={readDate(draft) ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => keys(e)}
        onBlur={() => end(draft, "stay")}
        aria-label="Date"
      />
    );
  if (type === "text")
    return (
      <textarea
        ref={ref}
        className="dag-grid__input dag-grid__input--text"
        data-dag-grid-input=""
        rows={Math.max(1, draft.split("\n").length)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => keys(e)}
        onBlur={() => end(draft, "stay")}
        aria-label="Text"
      />
    );
  return (
    <input
      ref={ref}
      className={`dag-grid__input dag-grid__input--${type}`}
      data-dag-grid-input=""
      inputMode={type === "number" ? "decimal" : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => keys(e)}
      onBlur={() => end(draft, "stay")}
      aria-label={COLUMN_LABEL[type]}
    />
  );
}

interface EditorParts {
  draft: string;
  setDraft(v: string): void;
  inputRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>;
  onKeys(e: KeyboardEvent<HTMLElement>, value?: string): void;
  onEnd(value: string | null, then: Then): void;
}

/**
 * A select's options. Every one shows until something is typed, and then those that hold it; the
 * arrows move through them and Enter picks the one marked — or, when nothing is, what was typed,
 * which a column with declared options then adds to them.
 */
function SelectEditor({
  draft,
  setDraft,
  options,
  inputRef,
  onKeys,
  onEnd,
  stored,
}: EditorParts & { options: readonly string[]; stored: string }) {
  const [at, setAt] = useState(() => (draft === stored ? options.indexOf(stored.trim()) : 0));
  const typed = draft === stored ? "" : draft.trim().toLowerCase();
  const shown = options.filter((o) => !typed || o.toLowerCase().includes(typed));
  const exact = options.find((o) => o.toLowerCase() === draft.trim().toLowerCase());
  const marked = at >= 0 && at < shown.length ? shown[at] : undefined;
  const pick = (v: string, then: Then = "stay") => onEnd(v, then);
  return (
    <div className="dag-grid__pop-anchor">
      <input
        ref={inputRef}
        className="dag-grid__input"
        data-dag-grid-input=""
        value={draft}
        placeholder="Pick or type an option"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        onChange={(e) => {
          setDraft(e.target.value);
          setAt(e.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = shown.length;
            if (n) setAt((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i <= 0 ? n : i) - 1));
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            return pick(marked ?? exact ?? draft.trim(), "down");
          }
          onKeys(e);
        }}
        onBlur={(e) => {
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-dag-grid-options]")) return;
          onEnd(exact ?? draft.trim(), "stay");
        }}
        aria-label="Option"
      />
      <div className="dag-grid__options" data-dag-grid-options="" role="listbox">
        {shown.map((o) => (
          <button
            key={o}
            type="button"
            role="option"
            aria-selected={o === marked}
            data-dag-grid-option={o}
            className="dag-grid__options-item"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o)}
          >
            <span className="dag-grid__option" style={hueVars(optionHue(options, o))}>
              {o}
            </span>
          </button>
        ))}
        {typed && !exact ? (
          <button
            type="button"
            className="dag-grid__options-item dag-grid__options-new"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(draft.trim())}
          >
            Add “{draft.trim()}”
          </button>
        ) : null}
        <button
          type="button"
          className="dag-grid__options-item dag-grid__options-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick("")}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * A link: a URL, or — as what is typed does not look like one — a document picked from the index,
 * written as `[Title](dag:<id>)`, which is a reference that shows in its backlinks. A link column holds either.
 */
function LinkEditor({ draft, setDraft, inputRef, onKeys, onEnd }: EditorParts) {
  const index = useIndex();
  const typed = draft.trim().toLowerCase();
  const url = /^(https?:|mailto:|dag:|\[)/i.test(draft.trim());
  const docs =
    typed && !url
      ? index.docs.filter((d) => titleOf(d).toLowerCase().includes(typed) || d.name.toLowerCase().includes(typed)).slice(0, 6)
      : [];
  return (
    <div className="dag-grid__pop-anchor">
      <input
        ref={inputRef}
        className="dag-grid__input"
        data-dag-grid-input=""
        value={draft}
        placeholder="A URL, or a document's title"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => onKeys(e)}
        onBlur={(e) => {
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-dag-grid-options]")) return;
          onEnd(draft, "stay");
        }}
        aria-label="Link"
      />
      {docs.length ? (
        <div className="dag-grid__options" data-dag-grid-options="" role="listbox">
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              role="option"
              aria-selected={false}
              className="dag-grid__options-item"
              data-dag-grid-link-doc={d.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onEnd(`[${cellSource(titleOf(d)).replace(/[[\]]/g, "")}](dag:${d.id})`, "stay")}
            >
              <span className="dag-grid__options-title">{titleOf(d)}</span>
              <span className="dag-grid__options-kind">{d.kind}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -- menus ---------------------------------------------------------------------------------------- */

/** A small card at the pointer, shut by a press elsewhere or Escape — Export's two ways. */
export function Pop({
  at,
  onClose,
  children,
  label,
}: {
  at: { x: number; y: number };
  onClose(): void;
  children: ReactNode;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y + 8 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(at.y + 8, innerHeight - r.height - 8)),
    });
  }, [at.x, at.y]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc, true);
    };
  }, [onClose]);
  return (
    <div ref={box} className="dag-grid__menu" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>
  );
}

function ColumnMenu({
  tab,
  c,
  at,
  edit,
  onInsert,
  onClose,
}: {
  tab: Tab;
  c: number;
  at: { x: number; y: number };
  edit: Edit;
  onInsert(where: { before?: number; after?: number }): void;
  onClose(): void;
}) {
  const col = tab.columns[c]!;
  const [name, setName] = useState(col.name);
  const [opts, setOpts] = useState((col.options ?? []).join(", "));
  const [sure, setSure] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.select(), []);
  const change = (ch: Parameters<typeof setColumn>[3]) => edit((t, a) => setColumn(t, a.tab, a.col(c), ch));
  const rename = () => {
    if (name.trim() && name !== col.name) change({ name: name.trim() });
  };
  const sortBy = (desc: boolean) => edit((t, a) => setTab(t, a.tab, { sort: [{ column: a.col(c), desc }] }));
  const filled = tab.rows.filter((r) => (r.cells[c] ?? "").trim()).length;
  return (
    <Pop at={at} onClose={onClose} label={`Column ${col.name}`}>
      <label className="dag-grid__menu-field">
        <span>Name</span>
        <input
          ref={nameRef}
          value={name}
          data-dag-grid-col-name=""
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              rename();
              onClose();
            }
          }}
        />
      </label>
      <div className="dag-grid__menu-types" role="radiogroup" aria-label="Type">
        {COLUMN_TYPES.map((t) => {
          const Icon = COLUMN_ICON[t];
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={col.type === t}
              data-dag-grid-type={t}
              className="dag-grid__menu-type"
              title={COLUMN_LABEL[t]}
              onClick={() => change({ type: t })}
            >
              <Icon {...ICON} aria-hidden="true" />
              <span>{COLUMN_LABEL[t]}</span>
            </button>
          );
        })}
      </div>
      {col.type === "select" ? (
        <label className="dag-grid__menu-field">
          <span>Options</span>
          <input
            value={opts}
            placeholder="Read off the values"
            data-dag-grid-col-options=""
            onChange={(e) => setOpts(e.target.value)}
            onBlur={() => {
              const list = opts
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              change({ options: list.length ? list : null });
            }}
          />
        </label>
      ) : null}
      <div className="dag-grid__menu-sep" />
      <button type="button" className="dag-grid__menu-item" data-dag-grid-sort="asc" onClick={() => (sortBy(false), onClose())}>
        <ArrowUpNarrowWide {...ICON} aria-hidden="true" /> Sort ascending
      </button>
      <button type="button" className="dag-grid__menu-item" data-dag-grid-sort="desc" onClick={() => (sortBy(true), onClose())}>
        <ArrowDownWideNarrow {...ICON} aria-hidden="true" /> Sort descending
      </button>
      <div className="dag-grid__menu-sep" />
      <button type="button" className="dag-grid__menu-item" onClick={() => (onInsert({ before: c }), onClose())}>
        <Plus {...ICON} aria-hidden="true" /> Insert left
      </button>
      <button type="button" className="dag-grid__menu-item" onClick={() => (onInsert({ after: c }), onClose())}>
        <Plus {...ICON} aria-hidden="true" /> Insert right
      </button>
      <button
        type="button"
        className="dag-grid__menu-item"
        disabled={c === 0}
        data-dag-grid-move="left"
        onClick={() => (edit((t, a) => moveColumn(t, a.tab, a.col(c), a.col(c - 1))), onClose())}
      >
        <ArrowLeft {...ICON} aria-hidden="true" /> Move left
      </button>
      <button
        type="button"
        className="dag-grid__menu-item"
        disabled={c === tab.columns.length - 1}
        data-dag-grid-move="right"
        onClick={() => (
          edit((t, a) => moveColumn(t, a.tab, a.col(c), c + 2 < tab.columns.length ? a.col(c + 2) : null)), onClose()
        )}
      >
        <ArrowRight {...ICON} aria-hidden="true" /> Move right
      </button>
      <div className="dag-grid__menu-sep" />
      {sure ? (
        <button
          type="button"
          className="dag-grid__menu-item dag-grid__menu-item--danger"
          data-dag-grid-delete-col="confirm"
          onClick={() => (edit((t, a) => removeColumn(t, a.tab, a.col(c))), onClose())}
        >
          <Trash2 {...ICON} aria-hidden="true" /> Delete it{filled ? ` and ${filled} ${filled === 1 ? "value" : "values"}` : ""}
        </button>
      ) : (
        <button
          type="button"
          className="dag-grid__menu-item dag-grid__menu-item--danger"
          data-dag-grid-delete-col=""
          onClick={() => setSure(true)}
        >
          <Trash2 {...ICON} aria-hidden="true" /> Delete column…
        </button>
      )}
    </Pop>
  );
}

function RowMenu({
  at,
  onInsert,
  onDelete,
  onClose,
}: {
  at: { x: number; y: number };
  onInsert(where: "above" | "below"): void;
  onDelete(): void;
  onClose(): void;
}) {
  return (
    <Pop at={at} onClose={onClose} label="Row">
      <button
        type="button"
        className="dag-grid__menu-item"
        data-dag-grid-row-insert="above"
        onClick={() => (onInsert("above"), onClose())}
      >
        <Plus {...ICON} aria-hidden="true" /> Insert above
      </button>
      <button
        type="button"
        className="dag-grid__menu-item"
        data-dag-grid-row-insert="below"
        onClick={() => (onInsert("below"), onClose())}
      >
        <Plus {...ICON} aria-hidden="true" /> Insert below
      </button>
      <div className="dag-grid__menu-sep" />
      <button
        type="button"
        className="dag-grid__menu-item dag-grid__menu-item--danger"
        data-dag-grid-row-delete=""
        onClick={() => (onDelete(), onClose())}
      >
        <Trash2 {...ICON} aria-hidden="true" /> Delete row
      </button>
    </Pop>
  );
}
