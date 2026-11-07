import { describe, expect, it } from "vitest";
import { parseBoard } from "../src/board/parseBoard";
import { stampItems } from "../src/board/stamp";
import fs from "node:fs";
import path from "node:path";

const ids = (text: string) => parseBoard("b", text).items.map((it) => it.id);

describe("stampItems", () => {
  it("writes an anonymous fence's own id onto it, and changes nothing else", () => {
    const text = "```md {x=10 y=20}\nhello\n```\n\n```arch\nservice a \"A\"\n```\n";
    const out = stampItems(text);
    expect(out).toBe("```md {#md-1 x=10 y=20}\nhello\n```\n\n```arch {#arch-1}\nservice a \"A\"\n```\n");
    expect(ids(out)).toEqual(ids(text));
  });

  it("wraps loose prose in a fence carrying the id it had", () => {
    const text = "# A heading\n\nSome words.\n\n```md {#note}\nhi\n```\n";
    const out = stampItems(text);
    expect(out.startsWith("```md {#md-1}\n# A heading\n\nSome words.\n```")).toBe(true);
    expect(ids(out)).toEqual(ids(text));
  });

  it("renames the second of two items that share an id, and writes the new one down", () => {
    const text = "```md {#a}\none\n```\n\n```md {#a}\ntwo\n```\n";
    const out = stampItems(text);
    const got = ids(out);
    expect(new Set(got).size).toBe(2);
    expect(got).toEqual(ids(text));
    expect(parseBoard("b", out).errors.filter((e) => /duplicate/i.test(e.message))).toEqual([]);
  });

  it("leaves a fully stamped board byte for byte alone", () => {
    const text = "---\ntitle: t\n---\n\n```md {#a x=1 y=2}\nhi\n```\n";
    expect(stampItems(text)).toBe(text);
  });

  it("is a fixed point, and keeps every id, over every board in the repository", () => {
    const root = path.resolve(import.meta.dirname, "../boards");
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".board.md") ? [path.join(d, e.name)] : [],
      );
    const files = walk(root);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const once = stampItems(text);
      expect(stampItems(once), f).toBe(once);
      expect(ids(once), f).toEqual(ids(text));
    }
  });
});
