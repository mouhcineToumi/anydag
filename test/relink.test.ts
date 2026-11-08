/**
 * `src/refs/relink.ts`: a rename keeps every `[[wikilink]]` naming what it named, in the form it was
 * written in, and touches no other byte.
 */
import { describe, expect, it } from "vitest";

import { changeOf, relinkText, type LinkKind } from "../src/refs/relink";
import type { WikiCandidate } from "../src/refs/wikilinks";

const doc = (id: string, name: string, kind = "note", title?: string): WikiCandidate => ({
  id,
  name,
  kind,
  title: title ?? name.slice(name.lastIndexOf("/") + 1),
});

/** `relinkText` over `text`, for a vault that went from `before` to `after`. */
function relink(text: string, before: WikiCandidate[], after: WikiCandidate[], kind: LinkKind = "note") {
  const change = changeOf(before, after);
  return change ? relinkText(text, kind, change) : { text, links: 0 };
}

const OTHER = doc("other00001", "Elsewhere");

describe("relinkText", () => {
  const before = [doc("plan000001", "Projects/Plan"), OTHER];
  const renamed = [doc("plan000001", "Projects/Budget plan"), OTHER];

  it("rewrites every form of link to a renamed note, and nothing else", () => {
    const text = [
      "---",
      "title: Notes",
      "---",
      "[[Plan]] and [[Plan|the plan]] and [[Plan#Costs]] and [[Plan#Costs|costs]] and [[Plan#^b1]].",
      "![[Plan]] and [[ Plan | spaced ]] and [[plan]] and [[Plan.md]] and [[Projects/Plan]].",
      "[[Elsewhere]] and [[Nowhere]] and [[#Heading]].",
      "",
    ].join("\n");
    const got = relink(text, before, renamed);
    expect(got.text).toBe(
      [
        "---",
        "title: Notes",
        "---",
        "[[Budget plan]] and [[Budget plan|the plan]] and [[Budget plan#Costs]] and [[Budget plan#Costs|costs]] and [[Budget plan#^b1]].",
        "![[Budget plan]] and [[ Budget plan | spaced ]] and [[Budget plan]] and [[Budget plan.md]] and [[Projects/Budget plan]].",
        "[[Elsewhere]] and [[Nowhere]] and [[#Heading]].",
        "",
      ].join("\n"),
    );
    expect(got.links).toBe(10);
  });

  it("returns the same string when nothing names what changed", () => {
    const text = "[[Elsewhere]] and [[Nowhere]]\n";
    const got = relink(text, before, renamed);
    expect(got).toEqual({ text, links: 0 });
    expect(relink("no links at all", before, renamed).links).toBe(0);
  });

  it("leaves code, maths, frontmatter and an ordinary link's text alone", () => {
    const text = [
      "---",
      'related: "[[Plan]]"',
      "---",
      "`[[Plan]]` and $[[Plan]]$ and [see [[Plan]]](https://example.com) and [[Plan]].",
      "",
      "```",
      "[[Plan]]",
      "```",
      "",
    ].join("\n");
    const got = relink(text, before, renamed);
    expect(got.links).toBe(1);
    expect(got.text).toBe(text.replace("and [[Plan]].", "and [[Budget plan]]."));
  });

  it("keeps a table cell's escaped bar", () => {
    const text = "| Link |\n| --- |\n| [[Plan\\|the plan]] |\n";
    expect(relink(text, before, renamed, "table").text).toBe("| Link |\n| --- |\n| [[Budget plan\\|the plan]] |\n");
  });

  it("follows a move: a leaf stays a leaf, a path is written whole, a partial path keeps its depth", () => {
    const b = [doc("plan000001", "Work/Q3/Plan"), OTHER];
    const a = [doc("plan000001", "Archive/2026/Plan"), OTHER];
    const text = "[[Plan]] [[Q3/Plan]] [[Work/Q3/Plan]]\n";
    // The leaf still names it: untouched. The paths do not: rewritten in their own form.
    expect(relink(text, b, a).text).toBe("[[Plan]] [[2026/Plan]] [[Archive/2026/Plan]]\n");
  });

  it("writes the shortest tail that names the document alone", () => {
    const b = [doc("plan000001", "Plan"), doc("plan000002", "Old/Plan")];
    const a = [doc("plan000001", "Work/Plan"), doc("plan000002", "Old/Plan")];
    // Moved off the top level, `[[Plan]]` would now tie with `Old/Plan`, which wins on its name.
    const got = relink("[[Plan]] and [[Plan|p]]\n", b, a);
    expect(got.text).toBe("[[Work/Plan]] and [[Work/Plan|p]]\n");
  });

  it("keeps a link naming the document it named when the moved one would win its tie", () => {
    const b = [doc("aplan00001", "a/Plan"), doc("bplan00001", "b/deep/Plan")];
    const a = [doc("aplan00001", "a/Plan"), doc("bplan00001", "Plan")];
    // `[[Plan]]` resolved by tail to `a/Plan`; the other one moved to the top and now matches exactly.
    const got = relink("[[Plan]]\n", b, a);
    expect(got.text).toBe("[[a/Plan]]\n");
  });

  it("brings a dangling link to life rather than touching it", () => {
    const b = [doc("plan000001", "Draft")];
    const a = [doc("plan000001", "Nowhere")];
    expect(relink("[[Nowhere]]\n", b, a).links).toBe(0);
  });

  it("follows a title a link named", () => {
    const b = [doc("plan000001", "work/q3-plan", "note", "The Q3 plan")];
    const a = [doc("plan000001", "work/q3-plan", "note", "Plan for Q3")];
    expect(relink("[[The Q3 plan]] and [[q3-plan]]\n", b, a).text).toBe("[[Plan for Q3]] and [[q3-plan]]\n");
  });

  it("keeps a kind's suffix, and an attachment's extension", () => {
    const b = [doc("board00001", "Arch", "board"), doc("file000001", "attachments/q3.pdf", "file", "Q3")];
    const a = [doc("board00001", "System", "board"), doc("file000001", "attachments/q3 report.pdf", "file", "Q3")];
    expect(relink("[[Arch.board]] ![[q3.pdf]] ![[attachments/q3.pdf]]\n", b, a).text).toBe(
      "[[System.board]] ![[q3 report.pdf]] ![[attachments/q3 report.pdf]]\n",
    );
  });

  it("rewrites every document under a moved folder", () => {
    const b = [doc("plan000001", "Work/Plan"), doc("budget0001", "Work/sub/Budget"), OTHER];
    const a = [doc("plan000001", "Done/Plan"), doc("budget0001", "Done/sub/Budget"), OTHER];
    expect(relink("[[Work/Plan]] [[Work/sub/Budget#x]] [[sub/Budget]] [[Budget]]\n", b, a).text).toBe(
      "[[Done/Plan]] [[Done/sub/Budget#x]] [[sub/Budget]] [[Budget]]\n",
    );
    // Moved deeper, a path that is still the tail of the new one still names it, and is left.
    const deeper = [doc("plan000001", "Done/Work/Plan"), doc("budget0001", "Done/Work/sub/Budget"), OTHER];
    expect(relink("[[Work/Plan]]\n", b, deeper).links).toBe(0);
  });

  it("leaves a link it cannot write in its own form", () => {
    const b = [doc("plan000001", "Plan")];
    const a = [doc("plan000001", "Plan #2")];
    expect(relink("[[Plan]]\n", b, a)).toEqual({ text: "[[Plan]]\n", links: 0 });
  });

  it("reads a board's md and note items, and nothing in a diagram", () => {
    const text = [
      "---",
      "title: Board",
      "---",
      "",
      "```md {#a}",
      "See [[Plan]].",
      "```",
      "",
      "```arch {#b}",
      'service api "[[Plan]]"',
      "```",
      "",
      "Loose prose: [[Plan#x]]",
      "",
      "```note {#c}",
      "`[[Plan]]` [[Plan|p]]",
      "```",
      "",
    ].join("\n");
    const got = relink(text, before, renamed, "board");
    expect(got.links).toBe(3);
    expect(got.text).toBe(
      text
        .replace("See [[Plan]].", "See [[Budget plan]].")
        .replace("prose: [[Plan#x]]", "prose: [[Budget plan#x]]")
        .replace("` [[Plan|p]]", "` [[Budget plan|p]]"),
    );
  });

  it("reads a quiz the way the index does", () => {
    const text = "---\ntitle: Drill\n---\n\n## Which is [[Plan]]? {#q1}\n\n- [x] [[Plan]]\n- [ ] no\n\n> See [[Plan]].\n";
    expect(relink(text, before, renamed, "quiz").text).toBe(text.split("[[Plan]]").join("[[Budget plan]]"));
  });

  it("finds nothing changed when only an unrelated document moved", () => {
    expect(changeOf([OTHER], [OTHER])).toBeNull();
  });
});
