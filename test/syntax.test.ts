import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checks, languageOf, loadSyntax, problemsSaid, readCode, segmentsOf, type CodeRead } from "@/render/syntax";

/**
 * A code block coloured by its language, and checked where the language's grammar can be
 * trusted to mean it. The grammars are real (Lezer's), loaded the way a page loads them.
 */

async function read(code: string, lang: string): Promise<CodeRead> {
  await loadSyntax(lang);
  const got = readCode(code, lang);
  if (!got) throw new Error(`${lang} did not load`);
  return got;
}

const word = (code: string, r: CodeRead, text: string): string | undefined => {
  const at = code.indexOf(text);
  return r.tokens.find((t) => t.from === at && t.to === at + text.length)?.cls;
};

describe("which language a fence names", () => {
  it("reads the words people write, and nothing it cannot colour", () => {
    expect(languageOf("py")).toBe("python");
    expect(languageOf("Python3")).toBe("python");
    expect(languageOf("postgresql")).toBe("sql");
    expect(languageOf("bash")).toBe("shell");
    expect(languageOf("tsx")).toBe("tsx");
    expect(languageOf("text")).toBeNull();
    expect(languageOf("")).toBeNull();
    expect(languageOf("brainfuck")).toBeNull();
  });

  it("checks only where the grammar agrees with the language", () => {
    expect(checks("python")).toBe(true);
    expect(checks("json")).toBe(true);
    expect(checks("ts")).toBe(false);
    expect(checks("sql")).toBe(false);
  });
});

describe("Python", () => {
  const ok = [
    "from collections import Counter",
    "",
    "class Solution:",
    "    def isAnagram(self, s: str, t: str) -> bool:",
    "        # Same letters, same counts.",
    "        if len(s) != len(t):",
    "            return False",
    '        return Counter(s) == Counter(t)  # "done"',
  ].join("\n");

  it("colours keywords, strings, comments and the name a function is given", async () => {
    const r = await read(ok, "python");
    expect(r.checked).toBe(true);
    expect(r.problems).toEqual([]);
    expect(word(ok, r, "class")).toBe("dag-tok-keyword");
    expect(word(ok, r, "return")).toBe("dag-tok-keyword");
    expect(word(ok, r, "# Same letters, same counts.")).toBe("dag-tok-comment");
    expect(word(ok, r, "isAnagram")).toBe("dag-tok-function");
    expect(word(ok, r, "False")).toBe("dag-tok-number");
  });

  it("says where it cannot read it, by line and column", async () => {
    const bad = "def f(:\n    return 1\n";
    const r = await read(bad, "python");
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems[0]).toMatchObject({ line: 1, col: 7 });
    expect(problemsSaid(r)).toBe("1 syntax error");
  });

  it("reads what its grammar alone would refuse: a bare yield, and a float written 20.", async () => {
    const r = await read("def gen():\n    yield\n\nCONNECTION_TIMEOUT = 20.\nx = (1.)\n", "python");
    expect(r.problems).toEqual([]);
  });
});

describe("the other checked languages", () => {
  it("JSON names a trailing comma", async () => {
    const r = await read('{"a": 1,}', "json");
    expect(r.problems).toHaveLength(1);
    /* The comma, not the brace the parser stopped at. */
    expect(r.problems[0].col).toBe(8);
    expect((await read('{"a": [1, 2], "b": null}', "json")).problems).toEqual([]);
  });

  it("CSS reads a rule's declarations on their own as clean", async () => {
    const decls = "color: var(--x);\nmargin: 0 auto;";
    const r = await read(decls, "css");
    expect(r.problems).toEqual([]);
    expect(word(decls, r, "color")).toBe("dag-tok-property");
    expect((await read(".a { color: red; ", "css")).problems.length).toBeGreaterThan(0);
  });

  it("YAML and JavaScript", async () => {
    expect((await read("a: 1\nb:\n  - x\n", "yaml")).problems).toEqual([]);
    expect((await read("a: [1, 2\nb: 3\n", "yml")).problems.length).toBeGreaterThan(0);
    expect((await read("const a = (x) => x * 2;", "js")).problems).toEqual([]);
    expect((await read("const a = ;", "js")).problems.length).toBeGreaterThan(0);
  });

  it("TypeScript is coloured and never checked: its grammar refuses forms TypeScript accepts", async () => {
    const r = await read("const isS = (s: unknown): s is string => typeof s === 'string';", "ts");
    expect(r.checked).toBe(false);
    expect(r.problems).toEqual([]);
    expect(r.tokens.length).toBeGreaterThan(0);
  });
});

describe("the tokenizers of our own", () => {
  it("SQL: keywords in any case, strings, comments, a function", async () => {
    const sql = "SELECT count(*) FROM cd.members -- all of them\nwhere joindate >= '2012-09-01';";
    const r = await read(sql, "postgresql");
    expect(word(sql, r, "SELECT")).toBe("dag-tok-keyword");
    expect(word(sql, r, "where")).toBe("dag-tok-keyword");
    expect(word(sql, r, "count")).toBe("dag-tok-function");
    expect(word(sql, r, "'2012-09-01'")).toBe("dag-tok-string");
    expect(word(sql, r, "-- all of them")).toBe("dag-tok-comment");
    expect(r.checked).toBe(false);
  });

  it("shell: the command, its options, a variable and a comment", async () => {
    const sh = "npm run dev --silent  # start it\necho \"$HOME\" | grep -v x";
    const r = await read(sh, "bash");
    expect(word(sh, r, "npm")).toBe("dag-tok-function");
    expect(word(sh, r, "--silent")).toBe("dag-tok-type");
    expect(word(sh, r, "# start it")).toBe("dag-tok-comment");
    expect(word(sh, r, "grep")).toBe("dag-tok-function");
  });
});

describe("cutting the text into what it wears", () => {
  it("covers every character once, in order, and lays a problem over the tokens it crosses", async () => {
    const code = "def f(:\n    return 1\n";
    const r = await read(code, "python");
    const segs = segmentsOf(code.length, r);
    expect(segs.map((s) => code.slice(s.from, s.to)).join("")).toBe(code);
    for (let i = 1; i < segs.length; i += 1) expect(segs[i].from).toBe(segs[i - 1].to);
    expect(segs.some((s) => s.problem)).toBe(true);
  });
});

describe("the code blocks this repository holds", () => {
  /* Every fenced block in a checked language, in every Markdown file here, reads clean: what the
     check says about a person's code should be true about ours first. */
  it("reads clean", async () => {
    /* Tracked files only: `boards/` is also where the e2e suite and a person's own files are written. */
    const files = execFileSync("git", ["ls-files", "--", "*.md"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const fence = /^(\s*)(`{3,})([\w+-]+)[^\n]*\n([\s\S]*?)\n\1\2\s*$/gm;
    const found: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(fence)) {
        if (!checks(m[3])) continue;
        const r = await read(m[4], m[3]);
        if (r.problems.length) found.push(`${f}: ${m[3]} line ${r.problems[0].line}`);
      }
    }
    expect(found).toEqual([]);
  });
});
