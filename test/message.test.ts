import { beforeAll, describe, expect, it } from "vitest";

import { parseSequence } from "@/dsl/sequence";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { layoutSequence } from "@/layout/sequence";
import { columnAt, drawMessage, runOf, slotAt, wrappable, wrapRun } from "@/edit/message";
import { edgeAt } from "@/edit/pick";
import type { Theme } from "@/theme/contract";

import theme from "../themes/paper/theme.json";

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const BODY = [
  'participant a "A"',
  'participant b "B"',
  'participant c "C"',
  'a ->> b : "one"',
  'opt "maybe"',
  '  b ->> c : "two"',
  "end",
  'c -->> a : "three"',
].join("\n");

describe("what a drag between lifelines means", () => {
  const placed = layoutSequence(parseSequence(BODY), T);
  const centre = (id: string) => placed.participants[id]!.x + placed.participants[id]!.w / 2;

  it("ends on the lifeline nearest where it let go", () => {
    expect(columnAt(placed.participants, centre("c") - 10)).toBe("c");
    expect(columnAt(placed.participants, (centre("a") + centre("b")) / 2 - 1)).toBe("a");
    expect(columnAt({}, 10)).toBeNull();
  });

  it("goes after the last row drawn above the drop, into a block when that row opens one", () => {
    const y = (line: number) => placed.rows.find((r) => r.line === line)!.y;
    expect(slotAt(placed.rows, y(4) - 5)).toBeNull();
    expect(slotAt(placed.rows, y(4) + 5)).toEqual({ line: 4, inside: false });
    expect(slotAt(placed.rows, y(5) + 1)).toEqual({ line: 5, inside: true });
    expect(slotAt(placed.rows, y(8) + 100)).toEqual({ line: 8, inside: false });
  });

  it("writes the message there and says what it will be picked as", () => {
    const inside = drawMessage(BODY, "c", "a", { line: 5, inside: true })!;
    expect(inside.body.split("\n")[5]).toBe('  c ->> a : "message"');
    expect(inside.id).toBe("msg:1");
    expect(inside.line).toBe(6);
    const top = drawMessage(BODY, "a", "a", null)!;
    expect(top.body.split("\n")[3]).toBe('a ->> a : "message"');
    expect(top.id).toBe("msg:0");
  });
});

describe("a run of messages", () => {
  it("is every message between the two ends, whichever was picked first", () => {
    expect(runOf({ id: "msg:3", to: "msg:1" })).toEqual(["msg:1", "msg:2", "msg:3"]);
    expect(runOf({ id: "msg:0" })).toEqual(["msg:0"]);
    expect(runOf({ id: "e3", to: "e4" })).toEqual(["e3"]);
  });

  it("can be wrapped only when its ends share a list", () => {
    expect(wrappable(BODY, { id: "msg:0" })).toBe(true);
    expect(wrappable(BODY, { id: "msg:0", to: "msg:2" })).toBe(true);
    expect(wrappable(BODY, { id: "msg:0", to: "msg:1" })).toBe(false);
    expect(wrappable(BODY, { id: "msg:7" })).toBe(false);
  });

  it("is wrapped, and the new fragment is named the way a pick names it", () => {
    const out = wrapRun(BODY, { id: "msg:2", to: "msg:0" }, "alt")!;
    expect(out.id).toBe("frag:0");
    expect(out.body.split("\n").slice(3)).toEqual([
      'alt "condition"',
      '  a ->> b : "one"',
      '  opt "maybe"',
      '    b ->> c : "two"',
      "  end",
      '  c -->> a : "three"',
      "end",
    ]);
    expect(wrapRun(BODY, { id: "msg:0", to: "msg:1" }, "alt")).toBeNull();
  });
});

describe("picking a message", () => {
  it("finds its line from the id the drawing carries", () => {
    expect(edgeAt("sequence", BODY, undefined, "msg:1")).toEqual({ line: 6, seg: 0 });
    expect(edgeAt("sequence", BODY, undefined, "msg:9")).toBeNull();
  });
});
