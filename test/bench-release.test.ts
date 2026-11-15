import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as benchRelease from "../scripts/bench-release.mjs";

const { missingReleaseRows, previousRelease, RELEASE_ROWS, releaseResults, releaseTable, releaseValues, writeRelease } =
  benchRelease;

/**
 * **The release table** (#328) is the one table a release carries, and its promise is that the rows
 * never move: a release is compared with the one before it, not with a report that changed shape.
 * The arithmetic is quiet when it is wrong — a percentage with the sign the wrong way says a
 * regression is an improvement — so it is held here, away from a bench that needs a server.
 */
describe("the release rows", () => {
  it("are the same ten every time", () => {
    expect(RELEASE_ROWS.map((row: { metric: string }) => row.metric)).toEqual([
      "desktop.startup.1000.cold.ready",
      "page.1000.search.first",
      "vault.1000.server.rss.rest",
      "vault.1000.list.cold",
      "vault.1000.list.warm",
      "vault.1000.index.cold",
      "vault.1000.index.warm",
      "vault.1000.search.cold",
      "vault.1000.search.warm",
      "board.500.ready",
    ]);
    expect(new Set(RELEASE_ROWS.map((row: { label: string }) => row.label)).size).toBe(RELEASE_ROWS.length);
  });

  it("puts a row the run did not measure in the file as n/a, in the rows' order", () => {
    const results = releaseResults([
      { metric: "vault.1000.list.cold", value: 168, unit: "ms" },
      { metric: "board.2000.ready", value: 5729, unit: "ms" },
    ]);
    expect(results).toHaveLength(RELEASE_ROWS.length);
    expect(results.map((row: { metric: string }) => row.metric)).toEqual(
      RELEASE_ROWS.map((row: { metric: string }) => row.metric),
    );
    expect(results.find((row: { metric: string }) => row.metric === "vault.1000.list.cold")).toEqual({
      metric: "vault.1000.list.cold",
      value: 168,
      unit: "ms",
    });
    expect(results.find((row: { metric: string }) => row.metric === "page.1000.search.first")).toEqual({
      metric: "page.1000.search.first",
      value: "n/a",
      unit: "ms",
    });
  });

  it("leaves a row the run did not measure out of the table's map, so it is not the same as n/a", () => {
    const values = releaseValues([{ metric: "vault.1000.server.rss.rest", value: 174, unit: "MB" }]);
    expect(values["vault.1000.server.rss.rest"]).toEqual({ value: 174, unit: "MB" });
    expect(values["page.1000.search.first"]).toBeUndefined();
  });

  it("names the rows --save must refuse: a baseline is never written with a hole in it", () => {
    const all = RELEASE_ROWS.map((row: { metric: string; unit: string }) => ({
      metric: row.metric,
      value: 1,
      unit: row.unit,
    }));
    expect(missingReleaseRows(all)).toEqual([]);
    const missing = missingReleaseRows(all.filter((row: { metric: string }) => row.metric !== "board.500.ready"));
    expect(missing).toEqual([{ metric: "board.500.ready", value: "n/a", unit: "ms" }]);
  });
});

describe("the table", () => {
  const current = releaseValues([
    { metric: "desktop.startup.1000.cold.ready", value: 1000, unit: "ms" },
    { metric: "vault.1000.server.rss.rest", value: 174, unit: "MB" },
    { metric: "vault.1000.list.cold", value: 160, unit: "ms" },
  ]);
  const previous = releaseValues([
    { metric: "desktop.startup.1000.cold.ready", value: 1250, unit: "ms" },
    { metric: "vault.1000.server.rss.rest", value: 174, unit: "MB" },
    { metric: "vault.1000.list.cold", value: 200, unit: "ms" },
    { metric: "page.1000.search.first", value: 100, unit: "ms" },
  ]);

  it("puts the previous release beside the new one, and lower is a minus", () => {
    const table = releaseTable({
      version: "0.7.0",
      machine: "a machine · 12 cores · Node v26.12.0",
      current,
      previous,
      previousVersion: "0.6.0",
    });
    expect(table).toContain("Machine: a machine · 12 cores · Node v26.12.0");
    expect(table).toContain("| Metric | 0.7.0 | 0.6.0 | Change |");
    expect(table).toContain("| Startup to a drawn board, 1,000 files | 1000 ms | 1250 ms | −20% |");
    expect(table).toContain("| Server memory at rest, 1,000 files | 174 MB | 174 MB | 0% |");
    expect(table).toContain("| `/__board/list` cold, 1,000 files | 160 ms | 200 ms | −20% |");
    /* The new run did not measure it, the previous one did: the row says so on both sides. */
    expect(table).toContain("| First search in the page, 1,000 files | n/a | 100 ms | — |");
    /* Neither did: n/a for this release, an em dash where a previous number would be. */
    expect(table).toContain("| A 500-item board to `data-dag-ready` | n/a | — | — |");
    expect(table).not.toContain("No earlier release");
  });

  it("says so, once, when there is no earlier release to compare with", () => {
    const table = releaseTable({ version: "0.7.0", machine: "a machine", current });
    expect(table).toContain("_No earlier release is committed in `docs/bench/`: this is the first table._");
    expect(table).toContain("| Metric | 0.7.0 | Previous | Change |");
    expect(table).toContain("| Startup to a drawn board, 1,000 files | 1000 ms | — | — |");
  });
});

describe("the file a release is compared with", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-bench-release-"));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => {
    /* Only the folders this file made, by the exact path `mkdtemp` returned. */
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const release = (version: string, value: number) => ({
    version,
    date: "2026-11-15T09:00:00.000Z",
    machine: "a machine",
    results: [{ metric: "vault.1000.list.cold", value, unit: "ms" }],
  });

  it("picks the greatest release below the one being cut, never the one itself", () => {
    const dir = tempDir();
    writeRelease(dir, release("0.5.0", 150));
    writeRelease(dir, release("0.6.0", 168));
    writeRelease(dir, release("0.7.0", 160));
    writeRelease(dir, release("0.8.0", 140));
    expect(
      previousRelease(dir, "0.7.0")?.results.find((row: { metric: string }) => row.metric === "vault.1000.list.cold")?.value,
    ).toBe(168);
    expect(previousRelease(dir, "0.8.0")?.version).toBe("0.7.0");
    expect(previousRelease(dir, "0.6.0")?.version).toBe("0.5.0");
    expect(previousRelease(dir, "0.5.0")).toBeNull();
    /* A beta of the version being cut compares with the stable release before it. */
    expect(previousRelease(dir, "0.7.0-beta.1")?.version).toBe("0.6.0");
  });

  it("ignores what is not a release file, and refuses one that is malformed", () => {
    const dir = tempDir();
    writeRelease(dir, release("0.6.0", 168));
    fs.writeFileSync(path.join(dir, "README.md"), "not a release\n");
    fs.writeFileSync(path.join(dir, "notes.json"), "[]\n");
    expect(previousRelease(dir, "0.7.0")?.version).toBe("0.6.0");

    fs.writeFileSync(path.join(dir, "0.7.0.json"), JSON.stringify({ version: "0.6.0", results: [] }));
    expect(() => previousRelease(dir, "0.8.0")).toThrow(/not a release file/);
  });

  it("writes the table's rows, which read back as the previous release", () => {
    const dir = tempDir();
    const file = writeRelease(dir, {
      version: "0.7.0",
      date: "2026-11-15T09:00:00.000Z",
      machine: "a machine",
      results: [
        { metric: "vault.1000.list.cold", value: 168, unit: "ms", note: "not kept" },
        { metric: "board.2000.ready", value: 5729, unit: "ms", note: "not a release row" },
      ],
    });
    expect(path.basename(file)).toBe("0.7.0.json");
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written.version).toBe("0.7.0");
    expect(written.machine).toBe("a machine");
    expect(written.results).toHaveLength(RELEASE_ROWS.length);
    expect(written.results[0]).toEqual({ metric: RELEASE_ROWS[0].metric, value: "n/a", unit: RELEASE_ROWS[0].unit });
    const previous = previousRelease(dir, "0.8.0");
    expect(previous?.version).toBe("0.7.0");
    expect(previous?.results.find((row: { metric: string }) => row.metric === "vault.1000.list.cold")?.value).toBe(168);
  });
});
