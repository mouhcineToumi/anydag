/**
 * `src/note/front.ts`: a note's frontmatter is the block between two `---` lines at its start only
 * when that block is one (#397). A body that opens with a rule and has another one further down is
 * all body — read so by the page, the index, search and a rename, and left alone by every writer.
 */
import { describe, expect, it } from "vitest";

import { joinNote, splitNote } from "@/note/format";
import { frontBlock } from "@/note/front";
import { eventOf, withEvent } from "@/note/event";
import { projectOf, withProject } from "@/note/project";
import { tagsOf, withTags } from "@/note/tags";
import { taskFactsOf, taskOf, withTask } from "@/note/task";
import { fillTemplate } from "@/note/template";
import { indexTexts, titleOf } from "@/refs/extract";
import { changeOf, relinkText } from "@/refs/relink";
import { noteCorpus } from "@/search/corpus";

import { frontId, withId } from "../server/ids";
import { withoutTitle, withTitle } from "../server/frontmatter";

/** The issue's note: a rule, a paragraph, a rule, a paragraph — and no frontmatter. */
const RULED = "---\n\nText after a rule.\n\n---\n\nMore.\n";

describe("what is a frontmatter", () => {
  it.each([
    ["a mapping", "---\ntitle: Plan\nstatus: todo\n---\nbody\n"],
    ["a mapping with a comment", "---\n# kept\nowner: someone\n---\n"],
    ["nothing but a blank line", "---\n\n---\nbody\n"],
    ["CRLF line ends", "---\r\ntitle: Windows\r\n---\r\nbody"],
    ["a template's, which YAML reads only once it is filled", "---\ntitle: {{title}}\ndue: {{date:YYYY-MM-DD}}\n---\n"],
    ["one somebody broke, which still opens with a key", "---\nstatus: [\n---\nbody\n"],
    ["a key twice, which YAML refuses", "---\ntitle: a\ntitle: b\n---\n"],
  ])("%s is one", (_, text) => {
    expect(frontBlock(text)).not.toBeNull();
  });

  it.each([
    ["the issue's: a sentence between two rules", RULED],
    ["a sentence right under the rule", "---\nJust words\n---\nMore.\n"],
    ["a heading, which YAML reads as a comment", "---\n\n# Chapter one\n\n---\n\nMore.\n"],
    ["a list", "---\n- one\n- two\n---\n"],
    ["a broken line that names no key", "---\n: : :\n---\nbody\n"],
    ["CRLF line ends", "---\r\n\r\nText after a rule.\r\n\r\n---\r\n\r\nMore.\r\n"],
  ])("%s is not", (_, text) => {
    expect(frontBlock(text)).toBeNull();
  });
});

describe("a note whose body opens with a rule (#397)", () => {
  it("is all body: the text between the rules is the editor's", () => {
    const f = splitNote(RULED);
    expect(f).toEqual({ front: "", body: RULED });
    expect(joinNote(f.front, f.body)).toBe(RULED);
  });

  it("still splits off a real frontmatter above the rules", () => {
    const text = `---\ntitle: Plan\n---\n${RULED}`;
    const f = splitNote(text);
    expect(f.front).toBe("---\ntitle: Plan\n---\n");
    expect(f.body).toBe(RULED);
    expect(f.title).toBe("Plan");
  });

  it("is read by no frontmatter reader", () => {
    expect(taskOf(RULED)).toBeUndefined();
    expect(eventOf(RULED)).toBeUndefined();
    expect(projectOf(RULED)).toBeUndefined();
    expect(tagsOf(RULED)).toEqual([]);
    expect(titleOf(RULED)).toBeUndefined();
    expect(frontId(RULED)).toBeNull();
  });

  it("counts the check items between the rules", () => {
    const text = "---\n\n- [x] one\n- [ ] two\n\n---\n\nMore.\n";
    expect(taskFactsOf(text)).toEqual({ body: true, items: { done: 1, total: 2 } });
  });

  it("grows a frontmatter above the rules on a write, and keeps every byte of the body", () => {
    const writes = [
      withTask(RULED, { status: "todo" }),
      withEvent(RULED, { start: "2026-11-17" }),
      withProject(RULED, { project: "active" }),
      withTags(RULED, { add: ["pricing"] }),
      withTitle(RULED, "Plan", "note"),
      withId(RULED, "0123456789"),
    ];
    for (const out of writes) {
      expect(out.endsWith(RULED)).toBe(true);
      const f = splitNote(out);
      expect(f.front).not.toBe("");
      expect(f.body).toBe(RULED);
    }
    expect(taskOf(writes[0]!)).toEqual({ status: "todo" });
    expect(tagsOf(writes[3]!)).toEqual(["pricing"]);
    expect(titleOf(writes[4]!)).toBe("Plan");
    expect(frontId(writes[5]!)).toBe("0123456789");
  });

  it("is left alone by a writer with nothing to take out", () => {
    expect(withTask(RULED, { status: null })).toBe(RULED);
    expect(withTags(RULED, { remove: ["pricing"] })).toBe(RULED);
    expect(withoutTitle(RULED)).toBe(RULED);
  });

  it("is searched, linked and relinked between the rules", () => {
    const text = "---\n\nSee [the plan](dag:0123456789) and [[Plan]].\n\n---\n\nMore.\n";
    expect(noteCorpus(text).units.some((u) => u.text.includes("See the plan"))).toBe(true);
    expect(indexTexts({ "a.note.md": text })["a.note.md"]!.refs.map((r) => r.id)).toContain("0123456789");
    const change = changeOf(
      [{ id: "plan000001", name: "Plan", kind: "note", title: "Plan" }],
      [{ id: "plan000001", name: "Budget", kind: "note", title: "Budget" }],
    );
    expect(relinkText(text, "note", change!).text).toBe(text.replace("[[Plan]]", "[[Budget]]"));
  });

  it("is filled as text by a template, not as YAML", () => {
    const text = "---\n\nWritten for {{title}}.\n\n---\n";
    const out = fillTemplate(text, { title: "Q3: the plan", at: 0, zone: "UTC" });
    expect(out).toBe("---\n\nWritten for Q3: the plan.\n\n---\n");
  });
});
