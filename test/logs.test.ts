import { describe, expect, it } from "vitest";

import { DIAGRAM_TYPES } from "@/board/types";

import { cleanBatch, cleanEvent, DIAGRAM_KINDS, EVENTS, localeOf, MAX_EVENTS, scrub } from "../sync/protocol/logs";

/**
 * The log vocabulary is the promise "no sensitive data": every hop runs it, so these are the
 * cases a document's words could otherwise leak through.
 */

const INSTALL = "0f8fad5b-d9cb-469f-a165-70867728950e";
const env = { version: "0.1.0", shell: "desktop", os: "linux", arch: "x64", locale: "en-GB", install: INSTALL };
const at = "2026-11-07T10:00:00.000Z";

describe("scrub", () => {
  it("takes out every quoted run, which is how the app reports a name", () => {
    expect(scrub("no board `Q3 secret plan` in “Acme” or 'x' or \"y\"", 300)).toBe('no board "…" in "…" or "…" or "…"');
  });

  it("keeps a script's file and position out of a URL or a path, and nothing else of either", () => {
    const stack = [
      "TypeError: x is undefined",
      "    at draw (http://localhost:3500/assets/index-Ab12Cd.js:12:34)",
      "    at run (anydag://app/assets/App-9f8e.js:1:2)",
      "    at Vault.read (/home/mouhcine/code/anydag/server/dist/anydag-server.mjs:1234:5)",
      "    at C:\\Users\\Mouhcine\\AppData\\anydag\\main.js:9:1",
    ].join("\n");
    const out = scrub(stack, 1500);
    expect(out).toContain("index-Ab12Cd.js:12:34");
    expect(out).toContain("App-9f8e.js:1:2");
    expect(out).toContain("anydag-server.mjs:1234:5");
    expect(out).toContain("main.js:9:1");
    for (const leak of ["mouhcine", "Mouhcine", "localhost", "/home", "AppData", "Users"]) expect(out).not.toContain(leak);
  });

  it("takes out paths, URLs, emails, file names and long ids", () => {
    const out = scrub(
      "ENOENT: open /home/someone/Vault/work/plan.board.md failed; see https://example.com/a?b=c from me@example.com for plan.note.md token 7q2m9xk4tb7q2m9xk4tb",
      300,
    );
    expect(out).toBe("ENOENT: open <path> failed; see <url> from <email> for <file> token <id>");
  });

  it("takes out a relative path a message did not quote", () => {
    expect(scrub("cannot move work/plans into itself", 300)).toBe("cannot move <path> into itself");
  });

  it("keeps a message that names nothing as it is", () => {
    expect(scrub("Cannot read properties of undefined (reading 'x')", 300)).toBe(
      'Cannot read properties of undefined (reading "…")',
    );
    expect(scrub("the board changed underneath this edit", 300)).toBe("the board changed underneath this edit");
  });

  it("cuts at its limit", () => {
    expect(scrub("a ".repeat(400), 20)).toHaveLength(20);
  });
});

describe("cleanEvent", () => {
  it("keeps the props an event names, of the kind it names, and drops the rest", () => {
    expect(cleanEvent({ name: "feature.use", at, props: { what: "tidy", title: "Secret", board: "plan" } })).toEqual({
      name: "feature.use",
      at: "2026-11-07T10:00:00Z",
      props: { what: "tidy" },
    });
  });

  it("refuses a word that is not on its list — a title cannot ride in an enum", () => {
    expect(cleanEvent({ name: "feature.use", at, props: { what: "Q3 plan" } })).toBeNull();
    expect(cleanEvent({ name: "app.open", at, props: { page: "board", shell: "my laptop" } })?.props).toEqual({ page: "board" });
  });

  it("refuses an unknown event, a bad time, a negative count", () => {
    expect(cleanEvent({ name: "document.text", at, props: { text: "hi" } })).toBeNull();
    expect(cleanEvent({ name: "feature.use", at: "yesterday", props: { what: "tidy" } })).toBeNull();
    expect(cleanEvent({ name: "board.open", at, props: { items: -1 } })).toBeNull();
    expect(cleanEvent({ name: "board.open", at, props: { items: 3, arch: 2, notes: 5 } })?.props).toEqual({ items: 3, arch: 2 });
  });

  it("scrubs an error's free text, and only takes a route that looks like one", () => {
    const e = cleanEvent({
      name: "error",
      at,
      props: {
        where: "server",
        kind: "route",
        message: "no note `Diary`",
        stack: "at /home/x/y.ts:1:2",
        route: "POST /__board/patch",
      },
    });
    expect(e?.props).toEqual({
      where: "server",
      kind: "route",
      message: 'no note "…"',
      stack: "at y.ts:1:2",
      route: "POST /__board/patch",
    });
    expect(cleanEvent({ name: "error", at, props: { where: "page", route: "GET /__board/get?name=Diary" } })?.props).toEqual({
      where: "page",
    });
  });

  it("rounds a duration", () => {
    expect(cleanEvent({ name: "page.ready", at, props: { page: "note", ms: 812.6 } })?.props).toEqual({ page: "note", ms: 813 });
  });
});

describe("cleanBatch", () => {
  it("needs an install and a version, and caps the events", () => {
    const events = Array.from({ length: MAX_EVENTS + 5 }, () => ({ name: "feature.use", at, props: { what: "search" } }));
    expect(cleanBatch({ v: 1, env, events })?.events).toHaveLength(MAX_EVENTS);
    expect(cleanBatch({ v: 1, env: { ...env, install: "me@example.com" }, events })).toBeNull();
    expect(cleanBatch({ v: 2, env, events })).toBeNull();
    expect(cleanBatch({ v: 1, env, events: [{ name: "nope", at, props: {} }] })).toBeNull();
  });

  it("keeps a locale to a language and a region, and a hostname nowhere", () => {
    const b = cleanBatch({
      v: 1,
      env: { ...env, locale: "fr-FR.UTF-8@home", host: "mouhcine-laptop" },
      events: [{ name: "feature.use", at, props: { what: "search" } }],
    });
    expect(b?.env).toEqual({ ...env, locale: "und" });
    expect(localeOf("fr_fr.UTF-8")).toBe("fr-FR");
  });
});

describe("the vocabulary", () => {
  it("names the fourteen diagram types", () => {
    expect([...DIAGRAM_KINDS].sort()).toEqual([...DIAGRAM_TYPES].sort());
  });

  it("has no free-text prop but an error's message and stack", () => {
    const text = Object.entries(EVENTS).flatMap(([name, props]) =>
      Object.entries(props)
        .filter(([, spec]) => spec === "text")
        .map(([k]) => `${name}.${k}`),
    );
    expect(text).toEqual(["error.message", "error.stack"]);
  });
});
