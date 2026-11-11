import { ArrowDownWideNarrow, Filter, Plus, Redo2, Trash2, Undo2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { sealId } from "@/board/envelope";
import type { BoardTree } from "@/board/useBoard";
import { History } from "@/edit/history";
import { typing } from "@/edit/useEditor";
import { fileStem, saveFile } from "@/export/save";
import { splitNote } from "@/note/format";
import { Backlinks } from "@/refs/Backlinks";
import { clearTarget, useTarget } from "@/refs/target";
import { csvTab, tabCsv } from "@/table/csv";
import { FILTER_OPS, parseTable, type FilterOp, type FilterRule, type SortKey, type Tab, type Table } from "@/table/parse";
import { viewRows } from "@/table/values";
import { TableError, addTab, moveTab, removeTab, setTab, stampTable } from "@/table/write";
import { ExportButton, TABLE_EXPORTS, exportRows } from "@/ui/Export";
import { PageBar } from "@/ui/PageBar";
import { refuseLocked, useLocked } from "@/settings/lock";
import { Toolbar } from "@/ui/Toolbar";
import { useDocFile } from "@/ui/docFile";
import { leaf } from "@/ui/tree";
import { TableFrame, keysOf, rowCount, tablePart } from "@/view/TableRead";

import { Grid, Pop, type At, type Edit } from "./Grid";
import { ProblemList } from "./ProblemList";
import { aboveGrid, problemsOf, repair, tabOfProblem, type Fix, type Problem } from "./problems";

/**
 * A table's own page — `?table=<name>&tab=<id>`.
 *
 * The toolbar has the title, the backlinks, Import CSV and Export. Under it, the tab's own
 * bar — Sort, Filter, how many rows show of how many, how many problems the file has, undo and redo —
 * then the grid, and the tabs along the bottom in the board's own strip.
 *
 * **There is no Source here.** The file's problems are said in words where they apply (`problems.ts`):
 * a tab's above its grid, a column's on its header, a row's — and its cells' — on its number, each with
 * the button that mends it, and the bar says how many and takes you to the first.
 *
 * **Every change is a writer over the text**, applied to what the page holds after `stampTable` has
 * given everything without an id one: so the grid can address a row by its place on screen and the
 * write names it by id, and the other writer's edit to any other row survives the merge. The file
 * is kept by `useDocFile` — the quiz's controller: a `put` against the sha1 last seen, a 409 merged
 * line by line, and *Keep mine* or *Use theirs* when the two touched one line.
 *
 * **ctrl+Z is a version of the file**, the board's rule (`src/edit/history.ts`): each write keeps the
 * text before it and after it, and a stack whose top is not what the page now holds — another
 * writer's change adopted — is dropped rather than applied over it.
 */

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The rows a filter says, as a person reads them; `=` with nothing after it is "is empty". */
const OP_LABEL: Readonly<Record<FilterOp, string>> = {
  "=": "is",
  "!=": "is not",
  "~": "contains",
  "!~": "does not contain",
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
};

/** A tab's id once `stampTable` has run, from its key in the strip — `#2` is the second tab. */
function tabIdIn(table: Table, key: string): string | undefined {
  const at = /^#(\d+)$/.exec(key);
  return at ? table.tabs[Number(at[1]) - 1]?.id : table.tabs.find((t) => t.id === key)?.id;
}

/** The tab a key names in a table, or by its place for a key made before it had an id. */
function tabFor(table: Table, key: string | null): Tab | undefined {
  if (key === null) return table.tabs[0];
  const i = keysOf(table.tabs).indexOf(key);
  if (i !== -1) return table.tabs[i];
  const at = /^#(\d+)$/.exec(key);
  return (at ? table.tabs[Number(at[1]) - 1] : undefined) ?? table.tabs[0];
}

/** An id a writer may address: one that names exactly one thing — two, and a write would land on the first. */
function only(id: string | undefined, all: readonly { id?: string }[], what: string): string {
  if (!id) throw new TableError(`that ${what} is not here any more`);
  if (all.filter((x) => x.id === id).length > 1)
    throw new TableError(`two ${what}s share the id \`${id}\`: give one its own first, from the problem marked on it`);
  return id;
}

export function TablePage({
  name,
  list,
  tab: tabParam,
  onTab,
  onBrowse,
  onOpenTables,
  snapshot,
  children,
}: {
  name: string;
  list: BoardTree;
  /** The tab in the address, or `null` for the first. */
  tab: string | null;
  onTab(tab: string | null): void;
  onBrowse(): void;
  /** Where to go when the table is not there any more. */
  onOpenTables(): void;
  snapshot: boolean;
  /** The cards the sidebar asks a page for. */
  children?: ReactNode;
}) {
  const file = useDocFile("table", name);
  /* Read only: the grid takes no edit, and `write` below refuses as the floor under it. */
  const locked = useLocked() && !snapshot;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const table = useMemo(() => parseTable(file.text), [file.text]);
  const ready = file.state.status === "ready" || file.state.status === "conflict";
  const problems = useMemo(() => (ready ? problemsOf(file.text, table) : []), [ready, file.text, table]);
  const title = list.titles[name] ?? splitNote(file.text).title ?? leaf(name);
  const id = list.ids[name];
  const [problem, setProblem] = useState<string | null>(null);
  const history = useRef(new History());
  /* What the page holds now — ahead of `file.text` between a write and the render it causes, so two
     writes in one tick (a paste, then its selection) each start from the other's answer. */
  const latest = useRef(file.text);
  const seen = useRef(file.text);
  if (seen.current !== file.text) {
    seen.current = file.text;
    latest.current = file.text;
  }

  const tabKeys = useMemo(() => keysOf(table.tabs), [table]);
  const current = ready ? tabFor(table, tabParam) : undefined;
  const currentKey = current ? tabKeys[table.tabs.indexOf(current)]! : null;

  /* A tab chosen before it had an id is named by its place; once a write has given it one, the
     address says the id, which survives the tabs being reordered. */
  useEffect(() => {
    if (current?.id && tabParam !== null && tabParam !== current.id) onTab(current.id);
  }, [current?.id, tabParam, onTab]);

  useEffect(() => {
    if (!problem) return;
    const t = setTimeout(() => setProblem(null), 6000);
    return () => clearTimeout(t);
  }, [problem]);

  /* Whatever scripts wait on: the page has its table. */
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.dagReady = "1";
    return () => {
      delete document.documentElement.dataset.dagReady;
    };
  }, [ready]);

  /** One change to the whole text, after every id is given. Refused writes say so, briefly. */
  const write = useCallback(
    (f: (text: string, stamped: Table) => string, key?: string) => {
      if (lockedRef.current) return void refuseLocked();
      const before = latest.current;
      const stamped = stampTable(before);
      let next: string;
      try {
        next = f(stamped, parseTable(stamped));
      } catch (e) {
        if (e instanceof TableError) {
          setProblem(`Not written: ${e.message}.`);
          return;
        }
        throw e;
      }
      if (next === before) return;
      history.current.push({ text: before, base: before }, { text: next, base: next }, key);
      latest.current = next;
      file.change(next);
    },
    [file],
  );

  /** The grid's writes: its positions in the tab it shows, turned into ids over the stamped text. */
  const edit = useCallback<Edit>(
    (f, key) => {
      if (currentKey === null) return;
      write((text, stamped) => {
        const tabId = only(tabIdIn(stamped, currentKey), stamped.tabs, "tab");
        const tab = stamped.tabs.find((t) => t.id === tabId)!;
        const at: At = {
          tab: tabId,
          row: (i) => only(tab.rows[i]?.id, tab.rows, "row"),
          col: (i) => only(tab.columns[i]?.id, tab.columns, "column"),
        };
        return f(text, at);
      }, key);
    },
    [currentKey, write],
  );

  /** One repair a problem offers, written like any other change — so it is one undo. */
  const fix = useCallback(
    (p: Problem, f: Fix) => {
      /* A refusal that sent the person to this button is answered by pressing it. */
      setProblem(null);
      write((text) => repair(text, p, f));
    },
    [write],
  );

  /* The bar's "show": the tab the first problem is on, then its mark brought into view. */
  const [revealing, setRevealing] = useState(false);
  const showProblems = () => {
    const here = current ? table.tabs.indexOf(current) : -1;
    const first = problems.find((p) => tabOfProblem(p) === here) ?? problems[0];
    if (!first) return;
    const t = tabOfProblem(first);
    if (t !== null && t !== here) onTab(tabKeys[t]!);
    setRevealing(true);
  };
  useEffect(() => {
    if (!revealing) return;
    setRevealing(false);
    const mark = document.querySelector<HTMLElement>("[data-dag-grid-flag]");
    mark?.scrollIntoView({ block: "center", inline: "center" });
    mark?.focus();
  }, [revealing, currentKey]);

  const restore = useCallback(
    (which: "undo" | "redo") => {
      if (lockedRef.current) return void refuseLocked();
      const back = which === "undo" ? history.current.undo(latest.current) : history.current.redo(latest.current);
      if (back === null) return;
      latest.current = back;
      file.change(back);
    },
    [file],
  );

  /* ctrl+Z and ctrl+shift+Z (or ctrl+Y), while the caret is in no field — a field's own undo is the field's. */
  useEffect(() => {
    if (snapshot) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        restore(e.shiftKey ? "redo" : "undo");
      } else if (k === "y") {
        e.preventDefault();
        restore("redo");
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [snapshot, restore]);

  /* A reference or a search result naming a tab and a row: the tab opened, the row marked. */
  const target = useTarget();
  const [mark, setMark] = useState<{ tab: string; index: number } | null>(null);
  useEffect(() => {
    if (!target || !ready) return;
    const part = tablePart(target);
    const tab = part.tab
      ? table.tabs.find((t) => t.id === part.tab)
      : part.line !== undefined
        ? table.tabs.find((t) => t.rows.some((r) => r.line === part.line))
        : undefined;
    if (tab) {
      const key = tabKeys[table.tabs.indexOf(tab)]!;
      if (key !== currentKey) onTab(key);
      const index = tab.rows.findIndex((r) => (part.row ? r.id === part.row : r.line === part.line));
      if (index !== -1) setMark({ tab: key, index });
    }
    clearTarget();
  }, [target, ready, table, tabKeys, currentKey, onTab]);

  /* -- the tabs ---------------------------------------------------------------------------------- */

  const tabEdit = useMemo(
    () => ({
      add() {
        let made: string | null = null;
        write((text, stamped) => {
          const names = new Set(stamped.tabs.map((t) => t.name));
          let n = stamped.tabs.length + 1;
          while (names.has(`Tab ${n}`)) n++;
          const added = addTab(text, {
            name: `Tab ${n}`,
            columns: [{ name: "Name" }],
            rows: [{ cells: [""] }, { cells: [""] }, { cells: [""] }],
          });
          made = added.id;
          return added.text;
        });
        if (made) onTab(made);
      },
      rename(key: string, next: string) {
        write((text, stamped) => setTab(text, only(tabIdIn(stamped, key), stamped.tabs, "tab"), { name: next }));
      },
      remove(key: string) {
        write((text, stamped) => removeTab(text, only(tabIdIn(stamped, key), stamped.tabs, "tab")));
        if (key === currentKey) onTab(null);
      },
      reorder(key: string, before: string | null) {
        write((text, stamped) =>
          moveTab(
            text,
            only(tabIdIn(stamped, key), stamped.tabs, "tab"),
            before === null ? null : only(tabIdIn(stamped, before), stamped.tabs, "tab"),
          ),
        );
      },
    }),
    [write, onTab, currentKey],
  );

  /* -- CSV in and out ------------------------------------------------------------------------------ */

  const picker = useRef<HTMLInputElement>(null);
  const importCsv = useCallback(
    async (f: File) => {
      const csv = await f.text();
      const { columns, rows } = csvTab(csv);
      if (columns.length === 0) {
        setProblem(`${f.name} has no header row to make columns of.`);
        return;
      }
      let made: string | null = null;
      write((text) => {
        const added = addTab(text, { name: f.name.replace(/\.(csv|tsv|txt)$/i, "") || "Imported", columns, rows });
        made = added.id;
        return added.text;
      });
      if (made) onTab(made);
    },
    [write, onTab],
  );

  const exportTable = useCallback(
    async (kind: "csv" | "md") => {
      await file.flush();
      if (kind === "md") {
        saveFile(`${fileStem(name)}.table.md`, id ? sealId(latest.current, id) : latest.current, "text/markdown");
        return;
      }
      if (!current) throw new Error("This table has no tab to export yet.");
      const stem = fileStem(name);
      const which = table.tabs.length > 1 ? `-${fileStem(current.name) || "tab"}` : "";
      saveFile(`${stem}${which}.csv`, tabCsv(current), "text/csv");
    },
    [file, name, id, current, table.tabs.length],
  );

  if (snapshot) {
    if (file.state.status === "loading") return null;
    return <TableFrame name={name} text={file.state.status === "missing" ? null : file.text} bar={null} />;
  }

  const here = current ? table.tabs.indexOf(current) : -1;
  const above = aboveGrid(problems, here);
  const shown = current ? viewRows(current).length : 0;

  let body: ReactNode;
  if (file.state.status === "loading") body = <div className="dag-tablepage dag-tablepage--loading" />;
  else if (file.state.status === "missing")
    body = (
      <div className="dag-tablepage" data-dag-tablepage-missing="">
        <p className="dag-grid__empty">This table is not here any more.</p>
        <button type="button" className="dag-grid__add" onClick={onOpenTables}>
          Search for another
        </button>
      </div>
    );
  else if (!current)
    body = (
      <div className="dag-tablepage__none">
        <p className="dag-grid__empty">This table has no tabs yet.</p>
        {locked ? null : (
          <button type="button" className="dag-grid__add" data-dag-tablepage-add-tab="" onClick={tabEdit.add}>
            <Plus {...ICON} aria-hidden="true" /> Add a tab
          </button>
        )}
      </div>
    );
  else
    body = (
      <div className="dag-tablepage__scroll">
        <Grid
          key={table.tabs.indexOf(current)}
          tab={current}
          edit={edit}
          readOnly={locked}
          onRefused={refuseLocked}
          mark={mark && mark.tab === currentKey ? mark.index : null}
          problems={{ list: problems, tab: here, onFix: fix }}
        />
      </div>
    );

  return (
    <div className="dag-app dag-app--table" data-dag-tablepage={name}>
      <Toolbar
        boardName={name}
        title={title}
        kind="table"
        onBoards={onBrowse}
        more={[
          /* A tab from a CSV file, beside the exports it is the other half of. */
          ...(ready
            ? [
                {
                  key: "import-csv",
                  label: "Import CSV",
                  icon: Upload,
                  hook: "data-dag-tablepage-import",
                  title: "Add a tab from a CSV file",
                  onSelect: () => picker.current?.click(),
                  disabled: locked,
                },
              ]
            : []),
          ...(id ? exportRows(TABLE_EXPORTS, exportTable) : []),
        ]}
      >
        <Backlinks id={id} />
        {id ? <ExportButton key={name} what="table" options={TABLE_EXPORTS} onExport={exportTable} /> : null}
      </Toolbar>
      {file.state.status === "conflict" ? (
        <div className="dag-tablepage__conflict" role="alert" data-dag-tablepage-conflict="">
          <span>Somebody changed the same rows while you were editing.</span>
          <button type="button" data-dag-tablepage-keep="" onClick={file.keepMine}>
            Keep mine
          </button>
          <button type="button" data-dag-tablepage-theirs="" onClick={file.useTheirs}>
            Use theirs
          </button>
        </div>
      ) : null}
      {ready ? (
        <div className="dag-tablepage__bar" data-dag-tablepage-bar="">
          {current ? (
            <>
              <SortButton tab={current} write={edit} />
              <FilterButton tab={current} write={edit} />
              <span className="dag-tablepage__count" data-dag-tablepage-count="">
                {rowCount(shown, current.rows.length)}
              </span>
            </>
          ) : null}
          <span className="dag-tablepage__status" role="status" data-dag-tablepage-status="">
            {problem ??
              (file.state.status === "ready" && file.state.failed ? (
                "Not saved yet. Trying again."
              ) : problems.length ? (
                <button type="button" className="dag-tablepage__show" data-dag-tablepage-show="" onClick={showProblems}>
                  {`${problems.length} ${problems.length === 1 ? "problem" : "problems"} in the file — show`}
                </button>
              ) : (
                ""
              ))}
          </span>
          <span className="dag-tablepage__spacer" />
          <button
            type="button"
            className="dag-icon"
            data-dag-tablepage-undo=""
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={locked || !history.current.canUndo}
            onClick={() => restore("undo")}
          >
            <Undo2 {...ICON} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="dag-icon"
            data-dag-tablepage-redo=""
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={locked || !history.current.canRedo}
            onClick={() => restore("redo")}
          >
            <Redo2 {...ICON} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {above.length ? (
        <div className="dag-tablepage__issues" data-dag-tablepage-issues="">
          <ProblemList problems={above} disabled={locked} onFix={fix} />
        </div>
      ) : null}
      {table.description ? <p className="dag-tablepage__description">{table.description}</p> : null}
      {body}
      {ready && table.tabs.length > 0 && currentKey ? (
        <PageBar
          pages={table.tabs.map((t, i) => ({ id: tabKeys[i]!, name: t.name }))}
          page={currentKey}
          onPage={onTab}
          edit={locked ? undefined : tabEdit}
          noun="tab"
        />
      ) : null}
      {/* Outside the toolbar, where it would sit between Import and Export and part their spacing. */}
      <input
        ref={picker}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
        hidden
        data-dag-tablepage-import-file=""
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importCsv(f);
        }}
      />
      {children}
    </div>
  );
}

/* -- sort and filter ---------------------------------------------------------------------------- */

/** A button in the tab's bar that opens a card under itself. */
function BarPop({
  icon,
  label,
  count,
  attr,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  attr: string;
  children(close: () => void): ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  return (
    <>
      <button
        type="button"
        className="dag-tablepage__pop"
        {...{ [attr]: "" }}
        aria-expanded={at !== null}
        data-on={count ? "" : undefined}
        onClick={(e) => {
          if (at) return setAt(null);
          const box = e.currentTarget.getBoundingClientRect();
          setAt({ x: box.left, y: box.bottom });
        }}
      >
        {icon}
        <span>{count ? `${label} · ${count}` : label}</span>
      </button>
      {at ? (
        <Pop at={at} onClose={close} label={label}>
          {children(close)}
        </Pop>
      ) : null}
    </>
  );
}

/** The tab's sort: one line per key — a column and a direction — written as the tab's `sort=`. */
function SortButton({ tab, write }: { tab: Tab; write: Edit }) {
  const save = (keys: SortKey[]) => write((t, a) => setTab(t, a.tab, { sort: keys.length ? keys : null }));
  const cols = tab.columns.filter((c) => c.id);
  return (
    <BarPop
      icon={<ArrowDownWideNarrow {...ICON} aria-hidden="true" />}
      label="Sort"
      count={tab.sort.length}
      attr="data-dag-tablepage-sort"
    >
      {() => (
        <div className="dag-tablepage__rules" data-dag-tablepage-sorts="">
          {tab.sort.length === 0 ? <p className="dag-tablepage__hint">Rows show in the order they are in the file.</p> : null}
          {tab.sort.map((k, i) => (
            <div key={i} className="dag-tablepage__rule" data-dag-tablepage-rule={i}>
              <select
                aria-label="Column"
                value={k.column}
                onChange={(e) => save(tab.sort.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
              >
                {cols.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Direction"
                value={k.desc ? "desc" : "asc"}
                onChange={(e) => save(tab.sort.map((x, j) => (j === i ? { ...x, desc: e.target.value === "desc" } : x)))}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button
                type="button"
                className="dag-icon"
                aria-label="Remove this sort"
                onClick={() => save(tab.sort.filter((_, j) => j !== i))}
              >
                <X {...ICON} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="dag-tablepage__rule-actions">
            <button
              type="button"
              className="dag-grid__menu-item"
              data-dag-tablepage-sort-add=""
              disabled={cols.length === 0}
              onClick={() => {
                const used = new Set(tab.sort.map((k) => k.column));
                const next = cols.find((c) => !used.has(c.id!)) ?? cols[0]!;
                save([...tab.sort, { column: next.id!, desc: false }]);
              }}
            >
              <Plus {...ICON} aria-hidden="true" /> Add a sort
            </button>
            {tab.sort.length ? (
              <button type="button" className="dag-grid__menu-item" data-dag-tablepage-sort-clear="" onClick={() => save([])}>
                <Trash2 {...ICON} aria-hidden="true" /> Clear
              </button>
            ) : null}
          </div>
        </div>
      )}
    </BarPop>
  );
}

/** What a filter line offers besides the eight operators: a test for emptiness, which is `=` or `!=` with nothing after it. */
type Test = FilterOp | "empty" | "filled";

const testOf = (r: FilterRule): Test =>
  r.value === "" && r.op === "=" ? "empty" : r.value === "" && r.op === "!=" ? "filled" : r.op;

/** The tab's filter: one line per rule, every rule kept — written as the tab's `filter=`. */
function FilterButton({ tab, write }: { tab: Tab; write: Edit }) {
  const save = (rules: FilterRule[]) => write((t, a) => setTab(t, a.tab, { filter: rules.length ? rules : null }));
  const cols = tab.columns.filter((c) => c.id);
  const set = (i: number, change: Partial<FilterRule>) => save(tab.filter.map((r, j) => (j === i ? { ...r, ...change } : r)));
  return (
    <BarPop
      icon={<Filter {...ICON} aria-hidden="true" />}
      label="Filter"
      count={tab.filter.length}
      attr="data-dag-tablepage-filter"
    >
      {() => (
        <div className="dag-tablepage__rules" data-dag-tablepage-filters="">
          {tab.filter.length === 0 ? <p className="dag-tablepage__hint">Every row shows.</p> : null}
          {tab.filter.map((r, i) => {
            const test = testOf(r);
            return (
              <div key={i} className="dag-tablepage__rule" data-dag-tablepage-rule={i}>
                <select aria-label="Column" value={r.column} onChange={(e) => set(i, { column: e.target.value })}>
                  {cols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Test"
                  data-dag-tablepage-test=""
                  value={test}
                  onChange={(e) => {
                    const v = e.target.value as Test;
                    if (v === "empty") set(i, { op: "=", value: "" });
                    else if (v === "filled") set(i, { op: "!=", value: "" });
                    else set(i, { op: v, value: test === "empty" || test === "filled" ? "" : r.value });
                  }}
                >
                  {FILTER_OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                  <option value="empty">is empty</option>
                  <option value="filled">is not empty</option>
                </select>
                {test === "empty" || test === "filled" ? null : (
                  <RuleValue value={r.value} onCommit={(value) => set(i, { value })} />
                )}
                <button
                  type="button"
                  className="dag-icon"
                  aria-label="Remove this filter"
                  onClick={() => save(tab.filter.filter((_, j) => j !== i))}
                >
                  <X {...ICON} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <div className="dag-tablepage__rule-actions">
            <button
              type="button"
              className="dag-grid__menu-item"
              data-dag-tablepage-filter-add=""
              disabled={cols.length === 0}
              onClick={() => save([...tab.filter, { column: cols[0]!.id!, op: "!=", value: "" }])}
            >
              <Plus {...ICON} aria-hidden="true" /> Add a filter
            </button>
            {tab.filter.length ? (
              <button type="button" className="dag-grid__menu-item" data-dag-tablepage-filter-clear="" onClick={() => save([])}>
                <Trash2 {...ICON} aria-hidden="true" /> Clear
              </button>
            ) : null}
          </div>
        </div>
      )}
    </BarPop>
  );
}

/** A rule's value, written when it is left or Enter is pressed — a filter per keystroke would hide the row being typed about. */
function RuleValue({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  /* A `"` would close the attribute the filter is written in, and a `;` would start another rule. */
  const commit = () => {
    const v = draft.replace(/["\n;]/g, " ").trim();
    if (v !== value) onCommit(v);
  };
  return (
    <input
      aria-label="Value"
      data-dag-tablepage-value=""
      value={draft}
      placeholder="Value"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}
