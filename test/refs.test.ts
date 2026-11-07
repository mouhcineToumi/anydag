import { describe, expect, it } from "vitest";
import { dagUrl, parseDagUrl, refsInBoard, refsInMarkdown } from "../src/refs/extract";

describe("references", () => {
  it("reads a link, an embed and a part, and nothing else", () => {
    const md = [
      "See [the plan](dag:0123456789) and [a block](dag:abcdefghjk#^para).",
      "",
      "![Architecture](dag:mnpqrstvwx)",
      "",
      "[a web link](https://example.com) and `[code](dag:0123456789)`",
      "",
      "```",
      "[fenced](dag:0123456789)",
      "```",
    ].join("\n");
    expect(refsInMarkdown(md)).toEqual([
      { id: "0123456789", type: "link", text: "the plan" },
      { id: "abcdefghjk", type: "link", part: "^para", text: "a block" },
      { id: "mnpqrstvwx", type: "embed", text: "Architecture" },
    ]);
  });

  it("refuses a URL that is not a whole id", () => {
    expect(parseDagUrl("dag:short")).toBeNull();
    expect(parseDagUrl("dag:0123456789x")).toBeNull();
    expect(parseDagUrl("https://x")).toBeNull();
    expect(parseDagUrl(dagUrl("0123456789", "md-1"))).toEqual({ id: "0123456789", part: "md-1" });
  });

  it("reads a board's Markdown items and not its diagrams", () => {
    const board = [
      "```md {#a}",
      "A card linking [the note](dag:0123456789).",
      "```",
      "",
      "```arch {#b}",
      'service x "[not a ref](dag:abcdefghjk)"',
      "```",
      "",
      "```md {#c}",
      "![The note, as a card](dag:0123456789)",
      "```",
    ].join("\n");
    expect(refsInBoard(board).map((r) => [r.id, r.type])).toEqual([
      ["0123456789", "link"],
      ["0123456789", "embed"],
    ]);
  });

  it("reads an image drawn from an attachment as an embed of it", () => {
    /* So the file's backlinks name the board, and deleting it asks first. A pasted picture is a
       path, not a reference, and a `dag:` anywhere else in a fence line is not one either. */
    const board = [
      '```image {#pic x=0 y=0 src="dag:k3f9x2m1qa"}',
      "The revenue chart",
      "```",
      "",
      "```image {#shot src=plan.assets/paste-1.png}",
      "```",
    ].join("\n");
    expect(refsInBoard(board)).toEqual([{ id: "k3f9x2m1qa", type: "embed", text: "The revenue chart" }]);
  });
});
