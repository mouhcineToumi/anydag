/**
 * The `.table.md` format: what `parseTable` reads, what the writers
 * change and what they leave alone, how a tab's sort and filter read its rows, the op list the api
 * applies, and CSV in and out.
 */
import { describe, expect, it } from "vitest";

import { csvTab, inferType, parseCsv, sniffDelimiter, tabCsv, toCsv } from "../src/table/csv";
import { tableData } from "../src/table/data";
import { applyTableOps, opProblem } from "../src/table/ops";
import { cellSource, cellText, parseTable, readFilter, readSort, splitRow } from "../src/table/parse";
import { readCell, readNumber, sortRows, tableDiagnostics, viewRows } from "../src/table/values";
import {
  addColumn,
  addRow,
  addTab,
  blankTable,
  moveColumn,
  moveRow,
  moveTab,
  removeColumn,
  removeRow,
  removeTab,
  setCell,
  setColumn,
  setRowHeight,
  setTab,
  slug,
  stampTable,
} from "../src/table/write";

const SAMPLE = `---
title: Q3 pipeline
---

The deals we are chasing.

## Deals {#deals sort="amount:desc" filter="stage!=Lost"}

| Name {#name}   | Amount {#amount number} | Close {#close date} | Won {#won checkbox} | Stage {#stage select options="Lead,Won,Lost"} | Site {#site link} |
| -------------- | ----------------------: | ------------------- | ------------------- | --------------------------------------------- | ----------------- |
| Acme {#racme}  | 1,200                   | 2026-10-01          | [x]                 | Won                                           | [acme.com](https://acme.com) |
| Globex {#rglo} | 800                     |                     | [ ]                 | Lead                                          | [Pricing](dag:7q2m9xk4tb) |
| Initech {#rini}| lots                    | 2026-13-01          | maybe               | Lost                                          | nope |

## Contacts {#contacts}

| Name {#name} | Email {#email link} |
| --- | --- |
| Ada {#rada} | mailto:ada@example.com |
`;

const codes = (text: string) => tableDiagnostics(parseTable(text)).map((d) => `${d.line}:${d.code}`);

describe("parseTable", () => {
  it("reads the frontmatter, the description, every tab, its columns and its rows", () => {
    const t = parseTable(SAMPLE);
    expect(t.front).toBe("---\ntitle: Q3 pipeline\n---\n");
    expect(t.description).toBe("The deals we are chasing.");
    expect(t.tabs.map((x) => [x.id, x.name])).toEqual([
      ["deals", "Deals"],
      ["contacts", "Contacts"],
    ]);
    const deals = t.tabs[0]!;
    expect(deals.columns.map((c) => [c.id, c.name, c.type])).toEqual([
      ["name", "Name", "text"],
      ["amount", "Amount", "number"],
      ["close", "Close", "date"],
      ["won", "Won", "checkbox"],
      ["stage", "Stage", "select"],
      ["site", "Site", "link"],
    ]);
    expect(deals.columns[4]!.options).toEqual(["Lead", "Won", "Lost"]);
    expect(deals.rows.map((r) => r.id)).toEqual(["racme", "rglo", "rini"]);
    expect(deals.rows[0]!.cells).toEqual(["Acme", "1,200", "2026-10-01", "[x]", "Won", "[acme.com](https://acme.com)"]);
    expect(deals.rows[1]!.cells[2]).toBe("");
    expect(deals.sort).toEqual([{ column: "amount", desc: true }]);
    expect(deals.filter).toEqual([{ column: "stage", op: "!=", value: "Lost" }]);
    expect(deals.line).toBe(7);
    expect(deals.rows[0]!.line).toBe(11);
  });

  it("warns about what does not read and errors only on a shared id", () => {
    expect(codes(SAMPLE)).toEqual(["13:WT_CELL", "13:WT_CELL", "13:WT_CELL", "13:WT_CELL"]);
    const dup = "## A {#a}\n\n| x {#x} | y {#x} |\n| - | - |\n| 1 {#r1} | 2 |\n| 3 {#r1} | 4 |\n\n## B {#a}\n";
    expect(codes(dup)).toEqual(["3:ET_DUPLICATE_ID", "6:ET_DUPLICATE_ID", "8:ET_DUPLICATE_ID"]);
  });

  it("takes a table in a code block for code, and a table above the first tab for the description", () => {
    const text = "Intro\n\n| a | b |\n| - | - |\n\n## T {#t}\n\n```\n| x | y |\n| - | - |\n```\n\n| c {#c} |\n| --- |\n";
    const t = parseTable(text);
    expect(t.tabs[0]!.columns).toEqual([]);
    expect(codes(text)).toEqual(["3:WT_LOOSE_TABLE", "8:WT_STRAY"]);
  });

  it("pads a short row, cuts a long one, and says so", () => {
    const t = parseTable("## T {#t}\n\n| a {#a} | b {#b} |\n| - | - |\n| 1 {#r1} |\n| 1 {#r2} | 2 | 3 |\n");
    expect(t.tabs[0]!.rows.map((r) => r.cells)).toEqual([
      ["1", ""],
      ["1", "2"],
    ]);
    expect(codes("## T {#t}\n\n| a {#a} | b {#b} |\n| - | - |\n| 1 {#r2} | 2 | 3 |\n")).toEqual(["5:WT_ROW_WIDTH"]);
  });

  it("reads an escaped pipe and a break inside a cell, and writes them back", () => {
    expect(splitRow("| a \\| b | c<br>d |").map((s) => s.raw)).toEqual(["a \\| b", "c<br>d"]);
    expect(cellText("a \\| b")).toBe("a | b");
    expect(cellText("c<br>d")).toBe("c\nd");
    expect(cellSource("a | b\nc")).toBe("a \\| b<br>c");
  });

  it("keeps a value with braces a value, and reads a row's attributes only when they mean a row", () => {
    const t = parseTable("## T {#t}\n\n| a {#a} |\n| - |\n| Use {braces} |\n| x {#r1 h=40} |\n");
    expect(t.tabs[0]!.rows.map((r) => [r.id, r.h, r.cells[0]])).toEqual([
      [undefined, undefined, "Use {braces}"],
      ["r1", 40, "x"],
    ]);
  });

  it("reads a sort and a filter, and warns about what names nothing", () => {
    expect(readSort("amount:desc, name ,  x:up").keys).toEqual([
      { column: "amount", desc: true },
      { column: "name", desc: false },
    ]);
    expect(readFilter("a>=3; b~acme; c=; d!=").rules).toEqual([
      { column: "a", op: ">=", value: "3" },
      { column: "b", op: "~", value: "acme" },
      { column: "c", op: "=", value: "" },
      { column: "d", op: "!=", value: "" },
    ]);
    expect(codes('## T {#t sort="nope" filter="x>1"}\n\n| a {#a} |\n| - |\n')).toEqual(["1:WT_BAD_SORT", "1:WT_BAD_FILTER"]);
  });

  it("says a table with no tabs is empty, and gives a tab no table without complaint", () => {
    expect(codes("---\ntitle: x\n---\n")).toEqual(["4:WT_EMPTY"]);
    expect(codes("## Empty {#e}\n")).toEqual([]);
  });
});

describe("reading a cell", () => {
  it("reads each type, and keeps what its type cannot read", () => {
    expect(readNumber("1,200")).toBe(1200);
    expect(readNumber("-3.5")).toBe(-3.5);
    expect(readNumber("12 000")).toBe(12000);
    expect(readNumber("1,2")).toBeNull();
    expect(readCell("date", "2026-02-30")).toEqual({ ok: false, value: "2026-02-30" });
    expect(readCell("checkbox", "")).toEqual({ ok: true, value: false });
    expect(readCell("checkbox", "[x]")).toEqual({ ok: true, value: true });
    expect(readCell("select", "Won", ["Lead", "Won"])).toEqual({ ok: true, value: "Won" });
    expect(readCell("select", "Maybe", ["Lead", "Won"]).ok).toBe(false);
    expect(readCell("link", "[Plan](dag:7q2m9xk4tb#deals)")).toEqual({
      ok: true,
      value: { text: "Plan", url: "dag:7q2m9xk4tb#deals", ref: { id: "7q2m9xk4tb", part: "deals" } },
    });
    expect(readCell("link", "https://a.b")).toEqual({ ok: true, value: { text: "https://a.b", url: "https://a.b" } });
    expect(readCell("number", "  ")).toEqual({ ok: true, value: null });
  });
});

describe("a tab's view", () => {
  const tab = parseTable(SAMPLE).tabs[0]!;
  it("sorts by its keys, stably, empty last and unreadable after every value", () => {
    expect(sortRows(tab, [{ column: "amount", desc: true }]).map((r) => r.row.id)).toEqual(["racme", "rglo", "rini"]);
    expect(sortRows(tab, [{ column: "amount", desc: false }]).map((r) => r.row.id)).toEqual(["rglo", "racme", "rini"]);
    expect(sortRows(tab, [{ column: "close", desc: false }]).map((r) => r.row.id)).toEqual(["racme", "rini", "rglo"]);
    expect(sortRows(tab, [{ column: "stage", desc: false }]).map((r) => r.row.id)).toEqual(["rglo", "racme", "rini"]);
    expect(sortRows(tab, []).map((r) => r.index)).toEqual([0, 1, 2]);
  });
  it("filters by every rule", () => {
    expect(viewRows(tab).map((r) => r.row.id)).toEqual(["racme", "rglo"]);
    const only = (filter: string) => viewRows(tab, [], readFilter(filter).rules).map((r) => r.row.id);
    expect(only("amount>=1000")).toEqual(["racme"]);
    expect(only("name~glo")).toEqual(["rglo"]);
    expect(only("name!~glo")).toEqual(["racme", "rini"]);
    expect(only("close=")).toEqual(["rglo"]);
    expect(only("close!=")).toEqual(["racme", "rini"]);
    expect(only("won=true")).toEqual(["racme"]);
    expect(only("stage=won")).toEqual(["racme"]);
    expect(only("site=Pricing")).toEqual(["rglo"]);
    expect(only("stage<=Won")).toEqual(["racme", "rglo"]);
  });
});

describe("the writers", () => {
  it("set one cell and leave every other byte alone", () => {
    const out = setCell(SAMPLE, "deals", "rglo", "amount", "950");
    const before = SAMPLE.split("\n");
    const after = out.split("\n");
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) if (i !== 11) expect(after[i]).toBe(before[i]);
    expect(after[11]).toBe(
      "| Globex {#rglo} | 950 |                     | [ ]                 | Lead                                          | [Pricing](dag:7q2m9xk4tb) |",
    );
    expect(parseTable(out).tabs[0]!.rows[1]!.cells[1]).toBe("950");
  });

  it("keep a row's id when its first cell changes, and escape what the file cannot hold", () => {
    const out = setCell(SAMPLE, "deals", "racme", "name", "Acme | Co\nLtd");
    const row = parseTable(out).tabs[0]!.rows[0]!;
    expect(row.id).toBe("racme");
    expect(row.cells[0]).toBe("Acme | Co\nLtd");
    expect(out).toContain("| Acme \\| Co<br>Ltd {#racme} |");
  });

  it("escape a pipe inside a header cell's braces, so an option holding one keeps the table", () => {
    const out = setColumn(SAMPLE, "deals", "stage", { options: ["Lead", "Won", "In|Out"] });
    expect(out).toContain('{#stage select options="Lead,Won,In\\|Out"}');
    const deals = parseTable(out).tabs[0]!;
    expect(deals.columns).toHaveLength(6);
    expect(deals.rows).toHaveLength(3);
    expect(deals.columns[4]!.options).toEqual(["Lead", "Won", "In|Out"]);
    /* And a row's own first cell, whose braces carry any attribute an agent wrote. */
    const row = setCell(out, "deals", "rglo", "stage", "In|Out");
    expect(parseTable(row).tabs[0]!.rows[1]!.cells[4]).toBe("In|Out");
  });

  it("write nothing for a write that means nothing", () => {
    expect(setCell(SAMPLE, "deals", "rglo", "amount", "800")).toBe(SAMPLE);
    expect(setTab(SAMPLE, "contacts", { name: "Contacts" })).toBe(SAMPLE);
    expect(setColumn(SAMPLE, "contacts", "email", { type: "link" })).toBe(SAMPLE);
    expect(moveRow(SAMPLE, "deals", "rini", null)).toBe(SAMPLE);
    expect(moveColumn(SAMPLE, "deals", "site", null)).toBe(SAMPLE);
    expect(moveTab(SAMPLE, "contacts", null)).toBe(SAMPLE);
  });

  it("refuse what is not there, by name", () => {
    expect(() => setCell(SAMPLE, "nope", "r", "c", "")).toThrow("no tab `nope`");
    expect(() => setCell(SAMPLE, "deals", "nope", "name", "")).toThrow("no row `nope`");
    expect(() => setCell(SAMPLE, "deals", "racme", "nope", "")).toThrow("no column `nope`");
  });

  it("add, move and remove a row as one line", () => {
    const added = addRow(SAMPLE, "contacts", { id: "rbob", values: { name: "Bob", email: "mailto:bob@example.com" } });
    expect(added.id).toBe("rbob");
    expect(added.text).toBe(`${SAMPLE}| Bob {#rbob} | mailto:bob@example.com |\n`);
    const after = addRow(SAMPLE, "deals", { after: "racme", values: { name: "Hooli" } });
    expect(parseTable(after.text).tabs[0]!.rows.map((r) => r.cells[0])).toEqual(["Acme", "Hooli", "Globex", "Initech"]);
    expect(after.id).toMatch(/^r[0-9a-z]{5}$/);
    const moved = moveRow(SAMPLE, "deals", "rini", "racme");
    expect(parseTable(moved).tabs[0]!.rows.map((r) => r.id)).toEqual(["rini", "racme", "rglo"]);
    expect(moved.length).toBe(SAMPLE.length);
    const gone = removeRow(SAMPLE, "deals", "rglo");
    expect(gone.split("\n").length).toBe(SAMPLE.split("\n").length - 1);
    expect(parseTable(gone).tabs[0]!.rows.map((r) => r.id)).toEqual(["racme", "rini"]);
  });

  it("refuse a row in a tab with no columns", () => {
    expect(() => addRow("## E {#e}\n", "e")).toThrow("has no columns");
  });

  it("give a row a height and take it off, in its first cell", () => {
    const tall = setRowHeight(SAMPLE, "contacts", "rada", 64);
    expect(tall).toContain("| Ada {#rada h=64} |");
    expect(setRowHeight(tall, "contacts", "rada", null)).toBe(SAMPLE);
  });

  it("add, move, retype and remove a column across the whole tab", () => {
    const { text, id } = addColumn(SAMPLE, "contacts", { name: "Phone Number", after: "name" });
    expect(id).toBe("phone-number");
    expect(text.split("## Contacts {#contacts}")[1]).toBe(
      "\n\n| Name {#name} | Phone Number {#phone-number} | Email {#email link} |\n| --- | --- | --- |\n| Ada {#rada} | | mailto:ada@example.com |\n",
    );
    const twice = addColumn(text, "contacts", { name: "Phone number" });
    expect(twice.id).toBe("phone-number-2");
    const moved = moveColumn(text, "contacts", "email", "name");
    expect(parseTable(moved).tabs[1]!.columns.map((c) => c.id)).toEqual(["email", "name", "phone-number"]);
    expect(parseTable(moved).tabs[1]!.rows[0]!.cells).toEqual(["mailto:ada@example.com", "Ada", ""]);
    expect(parseTable(moved).tabs[1]!.rows[0]!.id).toBe("rada");
    const numbered = setColumn(text, "contacts", "phone-number", { type: "number", name: "Phone" });
    expect(numbered).toContain("| Name {#name} | Phone {#phone-number number} | Email {#email link} |\n| --- | ---: | --- |");
    const removed = removeColumn(text, "contacts", "phone-number");
    expect(removed.split("## Contacts {#contacts}")[1]).toBe(
      "\n\n| Name {#name} | Email {#email link} |\n| --- | --- |\n| Ada {#rada} | mailto:ada@example.com |\n",
    );
  });

  it("give a select its options and a column its width on the header cell only", () => {
    const out = setColumn(SAMPLE, "contacts", "name", { w: 240 });
    expect(out.replace("| Name {#name w=240} |", "| Name {#name} |")).toBe(SAMPLE);
    const opts = setColumn(SAMPLE, "deals", "stage", { options: ["Lead", "Won", "Lost", "Paused"] });
    expect(parseTable(opts).tabs[0]!.columns[4]!.options).toEqual(["Lead", "Won", "Lost", "Paused"]);
  });

  it("write a table under a tab that had none, with its first column", () => {
    const { text } = addColumn("## Empty {#e}\n", "e", { name: "Title" });
    expect(text).toBe("## Empty {#e}\n\n| Title {#title} |\n| --- |\n");
    const row = addRow(text, "e", { id: "r1", values: { title: "one" } });
    expect(row.text).toBe("## Empty {#e}\n\n| Title {#title} |\n| --- |\n| one {#r1} |\n");
  });

  it("add, rename, sort, filter, move and remove a tab", () => {
    const added = addTab(SAMPLE, { name: "Notes" });
    expect(added.id).toBe("notes");
    expect(added.text).toBe(`${SAMPLE}\n## Notes {#notes}\n`);
    const between = addTab(SAMPLE, { name: "Deals", after: "deals" });
    expect(between.id).toBe("deals-2");
    expect(parseTable(between.text).tabs.map((t) => t.id)).toEqual(["deals", "deals-2", "contacts"]);
    expect(between.text).toContain("| nope |\n\n## Deals {#deals-2}\n\n## Contacts");
    const renamed = setTab(SAMPLE, "contacts", { name: "People", sort: "name", filter: "email~example" });
    expect(renamed).toContain('## People {#contacts sort=name filter="email~example"}\n');
    expect(setTab(renamed, "contacts", { name: "Contacts", sort: null, filter: null })).toBe(SAMPLE);
    const moved = moveTab(SAMPLE, "contacts", "deals");
    expect(parseTable(moved).tabs.map((t) => t.id)).toEqual(["contacts", "deals"]);
    expect(moveTab(moved, "deals", "contacts")).toBe(SAMPLE);
    const removed = removeTab(SAMPLE, "contacts");
    expect(parseTable(removed).tabs.map((t) => t.id)).toEqual(["deals"]);
    expect(removed.endsWith("| nope |\n")).toBe(true);
    expect(
      removeTab(SAMPLE, "deals").startsWith("---\ntitle: Q3 pipeline\n---\n\nThe deals we are chasing.\n\n## Contacts"),
    ).toBe(true);
  });

  it("stamp every missing id, and nothing else", () => {
    const bare = "## My Tab\n\n| First Name | Age {number} |\n| - | -: |\n| Ada | 36 |\n| Bob | 41 |\n";
    const stamped = stampTable(bare);
    const t = parseTable(stamped);
    expect(t.tabs[0]!.id).toBe("my-tab");
    expect(t.tabs[0]!.columns.map((c) => c.id)).toEqual(["first-name", "age"]);
    expect(t.tabs[0]!.rows.every((r) => /^r[0-9a-z]{5}$/.test(r.id ?? ""))).toBe(true);
    expect(t.tabs[0]!.rows.map((r) => r.cells)).toEqual([
      ["Ada", "36"],
      ["Bob", "41"],
    ]);
    expect(t.diagnostics).toEqual([]);
    expect(stampTable(stamped)).toBe(stamped);
    expect(stampTable(SAMPLE)).toBe(SAMPLE);
  });

  it("keep a file's CRLF line endings on every line they write", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const row = addRow(crlf, "contacts", { id: "rbob", values: { name: "Bob" } }).text;
    expect(row.endsWith("| Bob {#rbob} | |\r\n")).toBe(true);
    const col = addColumn(crlf, "contacts", { name: "Phone" }).text;
    expect(col.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(parseTable(setCell(crlf, "deals", "rglo", "amount", "9")).tabs[0]!.rows[1]!.cells[1]).toBe("9");
    expect(moveRow(crlf, "deals", "rini", "racme").replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("make a slug an id can be", () => {
    expect(slug("Café Owner #1")).toBe("cafe-owner-1");
    expect(slug("!!!")).toBe("col");
  });

  it("start a new table with one tab and somewhere to type", () => {
    const t = parseTable(blankTable());
    expect(t.tabs.map((x) => x.name)).toEqual(["Tab 1"]);
    expect(t.tabs[0]!.columns.map((c) => c.name)).toEqual(["Name", "Notes"]);
    expect(t.tabs[0]!.rows.length).toBe(3);
    expect(t.diagnostics).toEqual([]);
  });
});

describe("applyTableOps", () => {
  it("applies a list in order, naming what an earlier op added", () => {
    const done = applyTableOps(SAMPLE, [
      { op: "addTab", id: "people", name: "People" },
      { op: "addColumn", tab: "people", id: "who", name: "Who" },
      { op: "addColumn", tab: "people", name: "Age", type: "number" },
      { op: "addRow", tab: "people", id: "r1", values: { who: "Ada" } },
      { op: "cell", tab: "people", row: "r1", column: "age", value: "36" },
      { op: "setTab", tab: "people", sort: "age:desc" },
    ]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.minted).toEqual({ tabs: ["people"], columns: ["who", "age"], rows: ["r1"] });
    const data = tableData(done.text, { tab: "people" });
    expect(data.tabs[0]!.rows[0]).toMatchObject({ id: "r1", cells: { who: "Ada", age: "36" }, values: { who: "Ada", age: 36 } });
    expect(data.tabs[0]!.sort).toEqual([{ column: "age", desc: true }]);
  });

  it("refuses the whole list on a shape it cannot read, or a thing that is not there", () => {
    expect(applyTableOps(SAMPLE, [{ op: "cell", tab: "deals" }])).toEqual({
      ok: false,
      status: 400,
      error: "`cell` needs `row`, a string",
    });
    expect(applyTableOps(SAMPLE, [{ op: "explode" }])).toMatchObject({ ok: false, status: 400 });
    expect(applyTableOps(SAMPLE, [{ op: "removeRow", tab: "deals", row: "nope" }])).toEqual({
      ok: false,
      status: 404,
      error: "no row `nope` in the tab `deals`",
    });
    expect(opProblem({ op: "addColumn", tab: "t", name: "n", type: "money" })).toBe("`money` is not a column type");
  });

  it("imports a CSV as a new tab", () => {
    const done = applyTableOps(SAMPLE, [{ op: "importCsv", name: "Imported", csv: "Name,Count,When\nA,1,2026-01-01\nB,2,\n" }]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const tab = parseTable(done.text).tabs.find((t) => t.id === "imported")!;
    expect(tab.columns.map((c) => [c.id, c.type])).toEqual([
      ["name", "text"],
      ["count", "number"],
      ["when", "date"],
    ]);
    expect(tab.rows.map((r) => r.cells)).toEqual([
      ["A", "1", "2026-01-01"],
      ["B", "2", ""],
    ]);
  });
});

describe("CSV", () => {
  it("reads quotes, doubled quotes, breaks inside quotes and a BOM", () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\n"two\nlines",z\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });

  it("sniffs the delimiter", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(sniffDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(sniffDelimiter("a,b\n1,2\n")).toBe(",");
  });

  it("writes only the quotes it needs", () => {
    expect(toCsv([["a", "b,c", 'say "x"', "l1\nl2"]])).toBe('a,"b,c","say ""x""","l1\nl2"\r\n');
  });

  it("infers a type from the values", () => {
    expect(inferType(["1", "2.5", ""])).toBe("number");
    expect(inferType(["2026-01-01", ""])).toBe("date");
    expect(inferType(["yes", "no"])).toBe("checkbox");
    expect(inferType(["0", "1"])).toBe("number");
    expect(inferType(["https://a.b", "[x](dag:7q2m9xk4tb)"])).toBe("link");
    expect(inferType(["a", "1"])).toBe("text");
    expect(inferType([])).toBe("text");
  });

  it("turns a CSV into a tab's columns and rows, a break into a line of the cell", () => {
    const { columns, rows } = csvTab('Name,Done\n"Ada\nLovelace",yes\nBob,no\n');
    expect(columns).toEqual([
      { name: "Name", type: "text" },
      { name: "Done", type: "checkbox" },
    ]);
    expect(rows.map((r) => r.cells)).toEqual([
      ["Ada\nLovelace", "[x]"],
      ["Bob", "[ ]"],
    ]);
  });

  it("writes a tab as every row, in its sort order, unfiltered", () => {
    const tab = parseTable(SAMPLE).tabs[0]!;
    expect(tabCsv(tab).split("\r\n")).toEqual([
      "Name,Amount,Close,Won,Stage,Site",
      'Acme,"1,200",2026-10-01,true,Won,[acme.com](https://acme.com)',
      "Globex,800,,false,Lead,[Pricing](dag:7q2m9xk4tb)",
      "Initech,lots,2026-13-01,false,Lost,nope",
      "",
    ]);
  });

  it("round-trips through a tab", () => {
    const csv = 'Name,Note\na | b,"two\nlines"\n';
    const done = applyTableOps("", [{ op: "importCsv", name: "T", csv }]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.text).toContain("| a \\| b {#");
    expect(done.text).toContain("| two<br>lines |");
    expect(tabCsv(parseTable(done.text).tabs[0]!)).toBe(csv.replace(/\n/g, "\r\n").replace('"two\r\nlines"', '"two\nlines"'));
  });
});

describe("tableData", () => {
  it("answers every row with its cells as written and as read, in the view when asked", () => {
    const all = tableData(SAMPLE);
    expect(all.title).toBe("Q3 pipeline");
    expect(all.tabs[0]!.rows.map((r) => r.id)).toEqual(["racme", "rglo", "rini"]);
    expect(all.tabs[0]!.rows[2]!.unread).toEqual(["amount", "close", "won", "site"]);
    expect(all.tabs[0]!.rows[0]!.values.amount).toBe(1200);
    const view = tableData(SAMPLE, { view: true });
    expect(view.tabs[0]!.rows.map((r) => r.id)).toEqual(["racme", "rglo"]);
    expect(view.tabs[0]!.total).toBe(3);
  });
});
