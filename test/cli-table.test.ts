import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { kindQuery } from "../cli/board";
import type { Io } from "../cli/context";
import { main } from "./cli-reach";
import { handle } from "../server/handle";

/**
 * `anydag table`. The stubbed server answers the table routes the way the api does — by
 * handing the text to the grammar service's own `/table` (`server/handle.ts`), which is the
 * route's whole body — and everything else in the shapes `server/routes/` gives them.
 */

function recorder(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      write: (c) => out.push(String(c)),
      stdinIsTTY: false,
      stdoutIsTTY: false,
      readStdin: async () => "",
      ask: async () => "",
    },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

const TABLE = `---
title: Pipeline
---

## Deals {#deals}

| Name {#name} | Amount {#amount number} |
| --- | ---: |
| Acme {#racme} | 1200 |
| Globex {#rglo} | lots |
`;

/** A server holding one table, answering its routes through the grammar's own handler. */
function tableServer(start = TABLE): { seen: Seen[]; text(): string } {
  let text = start;
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ method: init.method ?? "GET", path: `${u.pathname}${u.search}`, body });
    const route = `${init.method ?? "GET"} ${u.pathname}`;
    if (route === "GET /__board/get") return json(200, { name: "pipeline", id: "0123456789", text, base: "b1" });
    if (route === "GET /__board/table") {
      const got = (await handle({ method: "POST", route: "/table", query: new URLSearchParams(), body: { text, view: u.searchParams.get("view") === "true", tab: u.searchParams.get("tab") ?? undefined } }))
        .body as { table: object };
      return json(200, { name: "pipeline", id: "0123456789", base: "b1", ...got.table });
    }
    if (route === "POST /__board/table") {
      const got = await handle({ method: "POST", route: "/table", query: new URLSearchParams(), body: { text, ops: body.ops } });
      if (got.status !== 200) return json(got.status, got.body);
      const done = got.body as { text: string; changed: boolean; minted: object; table: { diagnostics: unknown[] } };
      text = done.text;
      return json(200, { name: "pipeline", base: "b2", text, changed: done.changed, minted: done.minted, diagnostics: done.table.diagnostics });
    }
    if (route === "GET /__board/diagnostics") {
      const got = await handle({ method: "POST", route: "/diagnose", query: new URLSearchParams(), body: { name: "pipeline", text, kind: "table" } });
      return json(200, got.body);
    }
    if (route === "POST /__board/create") return json(200, { name: "deals", id: "abcdefghjk", base: "b0", text: body.text });
    return json(404, { error: `no route ${route}` });
  });
  return { seen, text: () => text };
}

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-table-"));
  env = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a table on the wire", () => {
  it("says kind=table", () => {
    expect(kindQuery("table")).toBe("table");
  });

  it("is read as a table by `table cat`", async () => {
    const { seen } = tableServer();
    const r = recorder();
    expect(await main(["table", "cat", "pipeline"], r.io, env)).toBe(0);
    expect(seen[0]!.path).toBe("/__board/get?name=pipeline&kind=table");
    expect(r.out.join("")).toBe(TABLE);
  });
});

describe("anydag table show", () => {
  it("prints every tab with its row and column ids, and marks what does not read", async () => {
    tableServer();
    const r = recorder();
    expect(await main(["table", "show", "pipeline"], r.io, env)).toBe(0);
    expect(r.out).toEqual([
      "Pipeline  0123456789",
      "",
      "## Deals  {#deals}  2 rows",
      "#      name    amount",
      "       Name    Amount (number)",
      "racme  Acme    1200",
      "rglo   Globex  lots ?",
    ]);
  });
});

describe("the edits", () => {
  it("sets a cell by id, through the route, and the table holds it", async () => {
    const t = tableServer();
    const r = recorder();
    expect(await main(["table", "set", "pipeline", "deals", "rglo", "amount", "950"], r.io, env)).toBe(0);
    const sent = t.seen.find((s) => s.method === "POST")!;
    expect(sent.path).toBe("/__board/table");
    expect(sent.body).toEqual({ name: "pipeline", ops: [{ op: "cell", tab: "deals", row: "rglo", column: "amount", value: "950" }] });
    expect(t.text()).toContain("| Globex {#rglo} | 950 |");
  });

  it("adds a row with its cells and prints its id", async () => {
    const t = tableServer();
    const r = recorder();
    expect(await main(["table", "row", "add", "pipeline", "deals", "name=Initech", "amount=12", "--id", "rini"], r.io, env)).toBe(0);
    expect(r.out).toEqual(["rini"]);
    expect(t.text()).toContain("| Initech {#rini} | 12 |");
  });

  it("adds a typed column and a tab, sorts and filters it, and refuses a type that is not one", async () => {
    const t = tableServer();
    const r = recorder();
    expect(await main(["table", "col", "add", "pipeline", "deals", "Close", "date", "--type", "date"], r.io, env)).toBe(0);
    expect(r.out).toEqual(["close-date"]);
    expect(await main(["table", "tab", "set", "pipeline", "deals", "--sort", "amount:desc", "--filter", "amount>=100"], r.io, env)).toBe(0);
    expect(t.text()).toContain('## Deals {#deals sort="amount:desc" filter="amount>=100"}');
    expect(await main(["table", "col", "add", "pipeline", "deals", "Money", "--type", "money"], recorder().io, env)).toBe(2);
    const tab = recorder();
    expect(await main(["table", "tab", "add", "pipeline", "People"], tab.io, env)).toBe(0);
    expect(tab.out).toEqual(["people"]);
  });

  it("refuses the whole list when it names nothing, with the route's words", async () => {
    tableServer();
    const r = recorder();
    expect(await main(["table", "row", "rm", "pipeline", "deals", "nope"], r.io, env)).not.toBe(0);
    expect(r.err.join("\n")).toContain("no row `nope` in the tab `deals`");
  });

  it("asks before a column goes, and --yes answers", async () => {
    const t = tableServer();
    expect(await main(["table", "col", "rm", "pipeline", "deals", "amount"], recorder().io, env)).toBe(2);
    expect(await main(["table", "col", "rm", "pipeline", "deals", "amount", "--yes"], recorder().io, env)).toBe(0);
    expect(t.text()).not.toContain("Amount");
  });
});

describe("CSV", () => {
  it("imports a file as a new table, titled after it", async () => {
    const t = tableServer("");
    const file = path.join(dir, "deals.csv");
    fs.writeFileSync(file, "Name,Amount\nAcme,12\n");
    const r = recorder();
    expect(await main(["table", "import", file], r.io, env)).toBe(0);
    const create = t.seen.find((s) => s.path === "/__board/create")!;
    expect(create.body).toEqual({ name: "deals", text: '---\ntitle: "deals"\n---\n', kind: "table" });
    expect(t.seen.at(-1)!.body).toEqual({ name: "deals", ops: [{ op: "importCsv", name: "deals", csv: "Name,Amount\nAcme,12\n" }] });
  });

  it("exports a tab as CSV", async () => {
    tableServer();
    const r = recorder();
    expect(await main(["table", "export", "pipeline"], r.io, env)).toBe(0);
    expect(r.out.join("")).toBe("Name,Amount\r\nAcme,1200\r\nGlobex,lots\r\n");
  });
});

describe("anydag table check", () => {
  it("prints the codes, and exits 4 on an error", async () => {
    tableServer(TABLE.replace("{#rglo}", "{#racme}"));
    const r = recorder();
    expect(await main(["table", "check", "pipeline"], r.io, env)).toBe(4);
    expect(r.out.some((l) => l.includes("ET_DUPLICATE_ID"))).toBe(true);
    expect(r.out.some((l) => l.includes("WT_CELL"))).toBe(true);
  });
});
