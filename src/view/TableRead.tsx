/**
 * A table drawn read-only.
 *
 * Three readers draw a table without editing it, and all three draw it with what is here: the
 * read-only page (`TableFrame`), a snapshot (every tab, one after
 * another), and a card on a board or an embed in a note (`TableCard`). The editor's grid draws its
 * cells with `CellView` too, so a value looks the same wherever it is — the view may be imported by
 * the editor, never the other way round, which `test/view-graph.test.ts` holds.
 *
 * **What a tab shows is what the file says**: its filter kept and its sort's order, read by
 * `viewRows` in `src/table/values.ts`, so the page, a card and an agent's `table_get --view` agree.
 */
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  Calendar,
  Check,
  CircleChevronDown,
  Hash,
  Link2,
  SquareCheck,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";

import { HUE_ORDER, type Hue } from "@/dsl/ir";
import { splitNote } from "@/note/format";
import { follow } from "@/refs/follow";
import { RefLink } from "@/refs/RefLink";
import { hueVars } from "@/render/hue";
import { parseTable, type Column, type ColumnType, type Tab } from "@/table/parse";
import { optionsOf, readCell, readLink, viewRows } from "@/table/values";
import { useTheme } from "@/theme/useTheme";
import { PageBar } from "@/ui/PageBar";

/** Each type's mark, on a column's header and in the type menu. */
export const COLUMN_ICON: Readonly<Record<ColumnType, LucideIcon>> = {
  text: Type,
  number: Hash,
  date: Calendar,
  checkbox: SquareCheck,
  select: CircleChevronDown,
  link: Link2,
};

/** Each type's name, as a person reads it. */
export const COLUMN_LABEL: Readonly<Record<ColumnType, string>> = {
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  select: "Select",
  link: "Link",
};

/** What a type expects, for the title on a value it cannot read. */
const EXPECTS: Readonly<Record<ColumnType, string>> = {
  text: "text",
  number: "a number",
  date: "a date, YYYY-MM-DD",
  checkbox: "a tick",
  select: "one of the options",
  link: "a link",
};

/**
 * A select's option wears a hue: the theme's, in `HUE_ORDER`, by the option's place in the list —
 * so an option keeps its colour however the rows are sorted, and no colour is written anywhere.
 */
export const optionHue = (options: readonly string[], value: string): Hue | undefined => {
  const at = options.indexOf(value);
  return at === -1 ? undefined : HUE_ORDER[at % HUE_ORDER.length];
};

/** A date cell's words — in UTC, because a written day is a calendar square, not an instant. */
const DAY = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** One cell's value, drawn by its column's type. A value the type cannot read is drawn as written, marked. */
export function CellView({ type, text, options }: { type: ColumnType; text: string; options: readonly string[] }) {
  const read = readCell(type, text, type === "select" ? options : undefined);
  if (!read.ok)
    return (
      <span className="dag-grid__value dag-grid__value--unread" data-dag-grid-unread="" title={`Not ${EXPECTS[type]}`}>
        {text}
      </span>
    );
  switch (type) {
    case "checkbox":
      return (
        <span
          className="dag-grid__check"
          data-dag-grid-check={read.value ? "on" : "off"}
          role="img"
          aria-label={read.value ? "Ticked" : "Not ticked"}
        >
          {read.value ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
        </span>
      );
    case "select":
      return read.value === null ? null : (
        <span className="dag-grid__option" style={hueVars(optionHue(options, String(read.value)))}>
          {String(read.value)}
        </span>
      );
    case "link": {
      const link = readLink(text);
      if (!link) return null;
      if (link.ref) return <RefLink id={link.ref.id} part={link.ref.part} fallback={link.text} />;
      return (
        <a className="dag-grid__link" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
          {link.text}
        </a>
      );
    }
    case "date": {
      /* Written `YYYY-MM-DD`, the file's form and what an agent types; read as words, the way every
         other date in the app is shown. The written form is the tooltip, and what the editor opens.
         An empty cell reads `null`, as an empty select does: `Intl.DateTimeFormat.format` throws on
         the invalid date `String(null)` would make, and the throw is in render, so it would take the
         whole page down. */
      if (read.value === null) return null;
      const day = String(read.value);
      return (
        <time className="dag-grid__value" dateTime={day} title={day}>
          {DAY.format(new Date(`${day}T12:00:00Z`))}
        </time>
      );
    }
    case "number":
    case "text":
      return text ? <span className="dag-grid__value">{text}</span> : null;
  }
}

/** A column's width: the one a person dragged, or its type's (`.dag-grid__col--<type>` in CSS). */
export const colStyle = (c: Column): CSSProperties | undefined => (c.w ? { width: `${c.w}px` } : undefined);

/**
 * One tab's grid, read-only: its header, then the rows it shows, as it shows them. `limit` stops
 * after that many — a card's preview — and says how many more there are. `mark` is a row a reference
 * or a search result named, drawn marked.
 */
function GridRead({ tab, limit, mark }: { tab: Tab; limit?: number; mark?: string | null }) {
  const rows = useMemo(() => viewRows(tab), [tab]);
  const options = useMemo(() => tab.columns.map((c, i) => (c.type === "select" ? optionsOf(c, tab.rows, i) : [])), [tab]);
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  const colKeys = keysOf(tab.columns);
  const rowKeys = keysOf(tab.rows);
  if (tab.columns.length === 0) return <p className="dag-grid__empty">This tab has no columns yet.</p>;
  return (
    <table className="dag-grid dag-grid--read" data-dag-grid={tab.id ?? ""}>
      <colgroup>
        {tab.columns.map((c, i) => (
          <col key={colKeys[i]} className={`dag-grid__col dag-grid__col--${c.type}`} style={colStyle(c)} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {tab.columns.map((c, i) => {
            const Icon = COLUMN_ICON[c.type];
            return (
              <th key={colKeys[i]} className="dag-grid__head" data-dag-grid-col={c.id ?? ""} scope="col">
                <span className="dag-grid__head-in">
                  <Icon size={12} strokeWidth={2} aria-hidden="true" />
                  <span className="dag-grid__name">{c.name}</span>
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {shown.map(({ row, index }) => (
          <tr
            key={rowKeys[index]}
            data-dag-grid-row={row.id ?? ""}
            data-dag-grid-marked={mark && row.id === mark ? "" : undefined}
            style={row.h ? { height: `${row.h}px` } : undefined}
          >
            {tab.columns.map((c, i) => (
              <td key={colKeys[i]} className={`dag-grid__cell dag-grid__cell--${c.type}`} data-dag-grid-cell={`${index}:${i}`}>
                <CellView type={c.type} text={row.cells[i] ?? ""} options={options[i]!} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {limit !== undefined && rows.length > limit ? (
        <tfoot>
          <tr>
            <td className="dag-grid__more" colSpan={tab.columns.length}>
              {rows.length - limit} more {rows.length - limit === 1 ? "row" : "rows"}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/**
 * Keys for a run of tabs, columns or rows: each one's id — or, for one with none yet, or one an
 * earlier sibling already has (a file with an `ET_DUPLICATE_ID` in it), its place, `#2`. React's keys
 * and the tab strip's both have to be unique whatever the file says, and an id never starts with `#`.
 */
export function keysOf(items: readonly { id?: string }[]): string[] {
  const seen = new Set<string>();
  return items.map((x, i) => {
    if (x.id === undefined || seen.has(x.id)) return `#${i + 1}`;
    seen.add(x.id);
    return x.id;
  });
}

/** How many rows a tab shows, and of how many, in the words a bar says it. */
export function rowCount(shown: number, total: number): string {
  return shown === total ? `${total} ${total === 1 ? "row" : "rows"}` : `${shown} of ${total} rows`;
}

/**
 * What a reference to a table names after its `#`: a tab, and a row in it — `deals/r7k2m` — or a row
 * by its line, `deals/L12`, which is what a search result names a row with no id yet.
 */
export function tablePart(part: string | null | undefined): { tab?: string; row?: string; line?: number } {
  if (!part) return {};
  const at = part.lastIndexOf("/");
  const tab = at === -1 ? part : part.slice(0, at);
  const rest = at === -1 ? "" : part.slice(at + 1);
  const line = /^L(\d+)$/.exec(rest);
  if (/^L\d+$/.test(tab) && at === -1) return { line: Number(tab.slice(1)) };
  return { tab, ...(line ? { line: Number(line[1]) } : rest ? { row: rest } : {}) };
}

/**
 * A table drawn read-only, with its bar — whoever loaded it, as `NoteFrame` is for a note. Its tabs
 * along the bottom, the board's own strip; under `?snapshot=1` every tab one after another instead,
 * each under its name, because a picture of a table is a fact about the whole file and a strip of
 * tabs nobody can press is a picture of one of them.
 */
export function TableFrame({ name, text, bar }: { name: string; text: string | null; bar: ReactNode }) {
  const query = new URLSearchParams(location.search);
  const snapshot = query.get("snapshot") === "1";
  useTheme(query.get("theme") ?? undefined, snapshot);
  const table = useMemo(() => (text === null ? null : parseTable(text)), [text]);
  const target = useMemo(() => tablePart(decodeURIComponent(location.hash.slice(1))), []);
  const [tab, setTab] = useState<string | null>(query.get("tab") ?? target.tab ?? null);

  useEffect(() => {
    if (text === null) return;
    document.documentElement.dataset.dagReady = "1";
    return () => {
      delete document.documentElement.dataset.dagReady;
    };
  }, [text]);

  const title = text === null ? name : (splitNote(text).title ?? name);
  const tabs = table?.tabs ?? [];
  const keys = keysOf(tabs);
  const at = tab === null ? -1 : keys.indexOf(tab);
  const current = tabs[at === -1 ? 0 : at];
  return (
    <div className="dag-app dag-app--table dag-app--view" data-dag-view="table">
      {bar}
      <main className="dag-tablepage dag-tablepage--read" data-dag-tablepage={name}>
        <h1 className="dag-tablepage__title">{title}</h1>
        {table?.description ? <p className="dag-tablepage__description">{table.description}</p> : null}
        {table === null ? null : tabs.length === 0 ? (
          <p className="dag-grid__empty">This table has no tabs yet.</p>
        ) : snapshot ? (
          tabs.map((t, i) => (
            <section key={keys[i]} className="dag-tablepage__tab">
              <h2 className="dag-tablepage__tabname">{t.name}</h2>
              <div className="dag-tablepage__scroll">
                <GridRead tab={t} />
              </div>
            </section>
          ))
        ) : current ? (
          <div className="dag-tablepage__scroll">
            <GridRead tab={current} mark={target.row ?? null} />
          </div>
        ) : null}
      </main>
      {!snapshot && tabs.length > 1 && current ? (
        <PageBar
          pages={tabs.map((t, i) => ({ id: keys[i]!, name: t.name }))}
          page={keys[tabs.indexOf(current)]!}
          onPage={setTab}
        />
      ) : null}
    </div>
  );
}

/**
 * A table on a board: **a live view of its data**. The table's mark, its title,
 * which tab and how many rows, then that tab's first rows as the tab shows them, clipped to the
 * card's width; a wider card shows more columns.
 *
 * **Open, and a double-click anywhere on the card, open the table.** Both stop the event at the card:
 * the press so the board does not select and drag the item on the way out, and the double-click so
 * the board does not also open its editor panel over the item — which is what a double-click on an
 * `md` card means everywhere else.
 */
export function TableCard({
  id,
  title,
  text,
  tab: wanted,
  href,
  rows = 10,
}: {
  id: string;
  title: string;
  /** The table's text: `undefined` while it is asked for, `null` when there is no such table. */
  text: string | null | undefined;
  tab?: string;
  href: string;
  rows?: number;
}) {
  const table = useMemo(() => (text ? parseTable(text) : null), [text]);
  const tab = table ? (table.tabs.find((t) => t.id === wanted) ?? table.tabs[0]) : undefined;
  const shown = useMemo(() => (tab ? viewRows(tab).length : 0), [tab]);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const open = (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    follow(href);
  };
  return (
    <div
      className="dag-embed dag-tablecard"
      data-dag-embed={id}
      data-dag-embed-kind="table"
      data-dag-tablecard={tab?.id ?? ""}
      data-dag-embed-ready={text === undefined ? undefined : ""}
      onDoubleClick={open}
    >
      <div className="dag-tablecard__head">
        <Table2 size={16} strokeWidth={2} aria-hidden="true" className="dag-tablecard__mark" />
        <span className="dag-tablecard__text">
          <span className="dag-tablecard__title" title={title}>
            {title}
          </span>
          <span className="dag-tablecard__what">
            {text === null
              ? "Nothing has this id any more"
              : tab
                ? `${table!.tabs.length > 1 ? `${tab.name} · ` : ""}${rowCount(shown, tab.rows.length)}`
                : text === undefined
                  ? " "
                  : "No tabs yet"}
          </span>
        </span>
        {text === null ? null : (
          <a
            className="dag-embed__open"
            href={href}
            data-dag-embed-open=""
            aria-label={`Open ${title}`}
            title="Open this table"
            onPointerDown={stop}
            onDoubleClick={stop}
          >
            <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
          </a>
        )}
      </div>
      {tab ? (
        <div className="dag-tablecard__grid">
          <GridRead tab={tab} limit={rows} />
        </div>
      ) : null}
    </div>
  );
}
