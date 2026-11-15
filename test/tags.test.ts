/**
 * A document's tags, read and written by `src/note/tags.ts`, held here to `test/fixtures/tags.json` —
 * so the sidebar, the Tasks page, the server's listing, the CLI and MCP cannot disagree about what a
 * document carries, and a write never takes a byte it was not asked to.
 */
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import fixture from "./fixtures/tags.json";
import { withKeys } from "../src/note/task";
import {
  cleanTag,
  defaultHue,
  entryOf,
  hasTag,
  pastedTags,
  sameTag,
  tagKey,
  tagOf,
  tagProblem,
  tagsOf,
  withTags,
  type TagChange,
} from "../src/note/tags";
import { HUE_ORDER } from "../src/dsl/ir";

const FIXTURE = fixture as unknown as {
  read: { why: string; text: string; tags: string[] }[];
  write: { why: string; text: string; change: TagChange; board?: boolean; out: string }[];
  keys: { why: string; text: string; set: Record<string, string | null>; keys: string[]; out: string }[];
  names: { why: string; typed: string; tag: string }[];
  hues: Record<string, string>;
};

describe("reading a document's tags", () => {
  it.each(FIXTURE.read.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(tagsOf(c.text)).toEqual(c.tags);
  });

  it("compares ignoring case", () => {
    expect(sameTag("Pricing", "pricing")).toBe(true);
    expect(tagKey("Réunion")).toBe("réunion");
    expect(hasTag("---\ntags: [Pricing]\n---\n", "PRICING")).toBe(true);
    expect(hasTag("---\ntags: [Pricing]\n---\n", "price")).toBe(false);
  });

  it("knows a tag from what is not one", () => {
    expect(tagOf("#meeting")).toBe("meeting");
    expect(tagOf("2026")).toBeUndefined();
    expect(tagOf("a b")).toBeUndefined();
    expect(tagOf(3)).toBeUndefined();
  });
});

describe("writing a document's tags", () => {
  it.each(FIXTURE.write.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(withTags(c.text, c.change, { board: c.board })).toBe(c.out);
  });

  it("reads back what it wrote, and writes it again as it is", () => {
    for (const c of FIXTURE.write) {
      const out = withTags(c.text, c.change, { board: c.board });
      expect(withTags(out, c.change, { board: c.board }), c.why).toBe(out);
      for (const tag of c.change.add ?? []) {
        const t = tagOf(tag);
        if (t) expect(hasTag(out, t), c.why).toBe(true);
      }
      for (const tag of c.change.remove ?? [])
        expect(hasTag(out, tag), c.why).toBe((c.change.add ?? []).some((a) => sameTag(a, tag)));
    }
  });

  it("writes a frontmatter every YAML reader parses, with the tags as strings", () => {
    for (const c of FIXTURE.write) {
      const out = withTags(c.text, c.change, { board: c.board });
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out);
      if (!m) continue;
      const data = parseYaml(m[1]!) as { tags?: unknown } | null;
      if (data?.tags === undefined) continue;
      expect(Array.isArray(data.tags), c.why).toBe(true);
      for (const t of data.tags as unknown[]) expect(typeof t === "string" || typeof t === "number", c.why).toBe(true);
    }
  });

  it("quotes an entry only when a YAML reader would read it as something else", () => {
    expect(entryOf("meeting")).toBe("meeting");
    expect(entryOf("area/design")).toBe("area/design");
    for (const word of ["yes", "No", "null", "true", "1e3", "0x1F", "1_000"]) expect(entryOf(word)).toBe(JSON.stringify(word));
  });
});

describe("withKeys, over a block list at column 0", () => {
  it.each(FIXTURE.keys.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(withKeys(c.text, c.set, c.keys)).toBe(c.out);
  });
});

describe("a name a person types", () => {
  it.each(FIXTURE.names.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(cleanTag(c.typed)).toBe(c.tag);
  });

  it("splits a pasted list into one tag per item", () => {
    expect(pastedTags("a, b c,,#d")).toEqual(["a", "b", "c", "d"]);
  });

  it("refuses digits alone, with the fix", () => {
    expect(tagProblem("2026")).toEqual({ message: "A tag needs a letter. Use q-2026?", fix: "q-2026" });
    expect(tagProblem("q-2026")).toBeUndefined();
    expect(tagProblem("")).toBeUndefined();
  });
});

describe("the default colour of a tag nobody registered", () => {
  it("is the same on every device, for every spelling", () => {
    for (const [name, hue] of Object.entries(FIXTURE.hues)) {
      expect(defaultHue(name)).toBe(hue);
      expect(defaultHue(name.toUpperCase())).toBe(hue);
    }
  });

  it("is one of the ten hues, and uses more than a few of them", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const hue = defaultHue(`tag-${i}`);
      expect(HUE_ORDER).toContain(hue);
      seen.add(hue);
    }
    expect(seen.size).toBe(HUE_ORDER.length);
  });
});
