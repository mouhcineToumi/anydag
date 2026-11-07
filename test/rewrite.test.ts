import { describe, expect, it } from "vitest";

import { applyPatch, type PatchOp, type SetOp } from "@/board/patch";
import { parseBoard } from "@/board/parseBoard";
import { proposedItem, rewriteContext, rewriteOps } from "@/edit/rewrite";

/**
 * What landing a rewrite means, minus the model and the pointer.
 *
 * The failure being guarded against is the landing itself: the answer is a whole body from a model
 * that saw one item, and everything that makes the item *this* item — its id, its place, its page,
 * the links naming it — has to come through untouched. One `SetOp` is the whole of that argument;
 * `SetOp`'s own doc comment in `patch.ts` is why remove-and-insert would not be.
 */

const BOARD = [
  "---",
  "pages: [One]",
  "---",
  "",
  '```arch {#x x=40 y=80 page=page-1 group=g1 title="Before" dir=TB}',
  'service db "DB"',
  "```",
  "",
  "```arch {#svc}",
  'service api "API"',
  "```",
  "",
  "```edges {#l}",
  "x.db --> svc",
  "```",
  "",
].join("\n");

const itemOf = (id: string) => parseBoard("t", BOARD).items.find((it) => it.id === id)!;

/** `rewriteOps` only ever emits a `SetOp`; this says so once, in one place, and narrows for free. */
const asSet = (op: PatchOp): SetOp => {
  if ("remove" in op || "insert" in op || "move" in op || "meta" in op) throw new Error("not a SetOp");
  return op;
};

describe("rewriteOps", () => {
  const draft = {
    type: "arch" as const,
    attrs: {
      title: "After",
      dir: "LR",
      /* Everything the model has no business with. */
      id: "hijacked",
      x: 999,
      y: 999,
      page: "page-1",
      group: "g2",
      w: 600,
      aspect: 0,
      frame: "full",
    },
    body: 'service db "Database"\nservice redis "Redis"\ndb --> redis',
  };

  it("emits exactly one SetOp carrying the body, and nothing else", () => {
    const ops = rewriteOps(itemOf("x"), draft);
    expect(ops).toHaveLength(1);
    expect(asSet(ops[0]!)).toMatchObject({ id: "x", body: draft.body });
  });

  it("never writes x, y, page, group or id", () => {
    const op = asSet(rewriteOps(itemOf("x"), draft)[0]!);
    expect(op.attrs).not.toHaveProperty("x");
    expect(op.attrs).not.toHaveProperty("y");
    expect(op.attrs).not.toHaveProperty("page");
    expect(op.attrs).not.toHaveProperty("group");
    expect(op.attrs).not.toHaveProperty("id");
  });

  it("leaves the type alone when the draft keeps it", () => {
    const op = asSet(rewriteOps(itemOf("x"), draft)[0]!);
    expect(op.type).toBeUndefined();
  });

  it("writes the new type when the person asked for another kind of diagram, keeping the id", () => {
    /* "Use another diagram type" was once refused on every attempt, the type being pinned. */
    const flow = { type: "flow" as const, attrs: {}, body: 'lane ops "Ops" {\n  step db "Database"\n}' };
    const op = asSet(rewriteOps(itemOf("x"), flow)[0]!);
    expect(op.type).toBe("flow");
    const done = applyPatch(BOARD, [op]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const next = parseBoard("t", done.text);
    expect(next.items.find((it) => it.id === "x")).toMatchObject({
      type: "flow",
      x: 40,
      y: 80,
      page: "page-1",
      group: "g1",
      title: "Before",
    });
    expect(next.links.map((l) => `${l.from.item}.${l.from.node} -> ${l.to.item}`)).toEqual(["x.db -> svc"]);
  });

  it("takes off what only the old type meant: layout=fixed, and a chart's size on a graph", () => {
    const fixed = parseBoard("t", '```arch {#f layout=fixed w=400}\nservice a "A" x=0 y=0\n```').items[0]!;
    const toState = asSet(rewriteOps(fixed, { type: "state", attrs: {}, body: 'state a "A"' })[0]!);
    expect(toState.attrs).toEqual({ layout: null, w: null });

    const chart = parseBoard("t", '```chart {#c w=600 h=320}\nbar\nseries a "A" 1\n```').items[0]!;
    expect(asSet(rewriteOps(chart, { type: "arch", attrs: {}, body: 'service a "A"' })[0]!).attrs).toEqual({ w: null, h: null });
    /* Chart to sketch keeps the box: both are sized by their author. */
    expect(asSet(rewriteOps(chart, { type: "sketch", attrs: {}, body: 'box a "A"' })[0]!).attrs).toBeUndefined();
  });

  it("merges the allowed attrs over the item's own, and drops the rest", () => {
    const op = asSet(rewriteOps(itemOf("x"), draft)[0]!);
    expect(op.attrs).toEqual({ title: "After", dir: "LR", aspect: 0, frame: "full" });
  });

  it("keeps the item's attr when the draft says nothing about it", () => {
    const op = asSet(rewriteOps(itemOf("x"), { ...draft, attrs: {} })[0]!);
    expect(op.attrs).toBeUndefined();
    const done = applyPatch(BOARD, [op]);
    expect(done.ok).toBe(true);
    const next = parseBoard("t", done.ok ? done.text : BOARD).items.find((it) => it.id === "x")!;
    expect(next).toMatchObject({ title: "Before", dir: "TB", x: 40, y: 80, page: "page-1", group: "g1", body: draft.body });
  });

  it("lands as one patch: the id, the placement and the links all survive", () => {
    const done = applyPatch(BOARD, rewriteOps(itemOf("x"), draft));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const next = parseBoard("t", done.text);
    expect(next.errors).toEqual([]);
    const x = next.items.find((it) => it.id === "x")!;
    expect(x).toMatchObject({ type: "arch", x: 40, y: 80, page: "page-1", group: "g1", dir: "LR", body: draft.body });
    /* The link into the rewritten item still resolves, because the id never moved. */
    expect(next.links.map((l) => `${l.from.item}.${l.from.node} -> ${l.to.item}`)).toEqual(["x.db -> svc"]);
    expect(done.text).not.toContain("```flow");
  });

  it("lets a chart-sized draft write w and h, and no other type", () => {
    const chart = parseBoard("t", "```chart {#c}\nbar\n```").items[0]!;
    const op = asSet(rewriteOps(chart, { ...draft, type: "chart", attrs: { w: 600, h: 320, title: "C" } })[0]!);
    expect(op.attrs).toEqual({ w: 600, h: 320, title: "C" });

    const onArch = asSet(rewriteOps(itemOf("x"), { ...draft, attrs: { w: 600, h: 320 } })[0]!);
    expect(onArch.attrs).toBeUndefined();
  });
});

describe("proposedItem", () => {
  it("draws the draft in the type it came back in, without what Accept would take off", () => {
    const chart = parseBoard("t", '```chart {#c w=600 h=320}\nbar\nseries a "A" 1\n```').items[0]!;
    const shown = proposedItem(chart, { type: "arch", attrs: {}, body: 'service a "A"' });
    expect(shown).toMatchObject({ id: "c", type: "arch", body: 'service a "A"', w: undefined, h: undefined });
    /* The layout cache is keyed on the hash, and a stale one hands back the chart. */
    expect(shown.hash).toBe(parseBoard("t", '```arch {#c}\nservice a "A"\n```').items[0]!.hash);
  });

  it("is only the body when the type stays", () => {
    const shown = proposedItem(itemOf("x"), { type: "arch", attrs: {}, body: 'service db "Database"' });
    expect(shown).toMatchObject({ type: "arch", title: "Before", dir: "TB", body: 'service db "Database"' });
    expect(shown.hash).not.toBe(itemOf("x").hash);
  });
});

describe("rewriteContext", () => {
  it("names the ids the rest of the board links into the selection", () => {
    const b = parseBoard("t", BOARD);
    expect(rewriteContext(b, new Set(["x"]))).toBe("Keep the ids other items link into unchanged: db.");
  });

  it("covers a multi-item selection", () => {
    const b = parseBoard("t", BOARD);
    expect(rewriteContext(b, new Set(["x", "svc"]))).toBe("Keep the ids other items link into unchanged: db.");
  });

  it("contributes nothing when nothing references the selection", () => {
    const b = parseBoard("t", BOARD);
    expect(rewriteContext(b, new Set(["svc"]))).toBe("");
    expect(rewriteContext(b, new Set(["nope"]))).toBe("");
  });

  it("never names a link that only names the item itself", () => {
    const b = parseBoard("t", '```arch {#x}\nservice db "DB"\n```\n\n```edges {#l}\nx --> x.db\n```\n');
    expect(rewriteContext(b, new Set(["x"]))).toBe("Keep the ids other items link into unchanged: db.");
  });
});
