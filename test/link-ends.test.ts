import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { linkEndChoices } from "@/edit/linkEnds";

const BOARD = [
  "```usecase {#who x=0 y=0}",
  'actor person "Someone"',
  "```",
  "",
  '```arch {#stack x=600 y=0 title="Stack" group=back}',
  'service api "API"',
  'store db "Database"',
  "```",
  "",
  "```md {#note x=0 y=400}",
  "hello",
  "```",
  "",
  "```edges {#links}",
  "who --> stack.db",
  "```",
  "",
].join("\n");

describe("linkEndChoices", () => {
  const board = parseBoard("t", BOARD);
  const page = board.items[0]!.page;
  const choices = linkEndChoices(board.items, page);
  const all = choices.flatMap(([, ids]) => ids);

  it("offers the items on the page, the cards inside each diagram, and the groups", () => {
    expect(choices[0]).toEqual(["Items", ["who", "stack", "note"]]);
    expect(choices.find(([label]) => label === "In Stack")?.[1]).toEqual(["stack.api", "stack.db"]);
    expect(choices.find(([label]) => label === "Groups")?.[1]).toEqual(["back"]);
  });

  it("never offers the links fence itself", () => {
    expect(all).not.toContain("links");
  });

  it("offers only what the board then resolves", () => {
    for (const id of all.filter((x) => x !== "who")) {
      const next = BOARD.replace("who --> stack.db", `who --> ${id}`);
      expect(parseBoard("t", next).links, id).toHaveLength(1);
    }
  });
});
