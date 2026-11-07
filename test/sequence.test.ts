import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { parseSequence } from "@/dsl/sequence";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { layoutSequence } from "@/layout/sequence";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const SRC = fs
  .readFileSync(path.resolve(__dirname, "../boards/local/reference/sequence.board.md"), "utf8")
  .split("```")[1]!
  .split("\n")
  .slice(1)
  .join("\n");

describe("sequence parsing", () => {
  const model = parseSequence(SRC);

  it("reads every participant in column order", () => {
    expect(model.participants.map((p) => p.id)).toEqual(["learner", "web", "api", "auth", "store"]);
    expect(model.participants[0]!.kind).toBe("person");
  });

  it("tells a call from a return", () => {
    const calls = model.events.filter((e) => e.t === "msg" && e.style === "call");
    const returns = model.events.filter((e) => e.t === "msg" && e.style === "return");
    expect(calls.length).toBeGreaterThan(0);
    expect(returns.length).toBeGreaterThan(0);
  });

  it("nests an alt with both its branches", () => {
    const frag = model.events.find((e) => e.t === "fragment");
    expect(frag).toBeDefined();
    if (frag?.t !== "fragment") throw new Error("not a fragment");
    expect(frag.kind).toBe("alt");
    expect(frag.branches.map((b) => b.label)).toEqual(["the answer is correct", "it is wrong"]);
    expect(frag.branches[0]!.events.length).toBe(3);
    expect(frag.branches[1]!.events.length).toBe(1);
  });

  it("keeps backticked text mono and prose not", () => {
    const msgs = model.events.filter((e) => e.t === "msg");
    expect(msgs.find((m) => m.t === "msg" && m.text === "submit an answer")!.t === "msg").toBe(true);
    const mono = msgs.filter((m) => m.t === "msg" && m.mono);
    expect(mono.length).toBeGreaterThan(0);
  });

  it("names the line of an unclosed fragment", () => {
    const bad = parseSequence(`a ->> b : "x"\nalt "never closed"\n  a ->> b : "y"`);
    expect(bad.diagnostics.some((d) => d.code === CODES.E_UNCLOSED_FRAGMENT)).toBe(true);
  });

  it("reads a namespaced icon on a participant, as every other dialect does", () => {
    const m = parseSequence(`participant q "Queue" icon=aws:sqs hue=indigo\nq ->> q : "tick"`);
    expect(m.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(m.participants[0]!.icon).toBe("aws:sqs");
    expect(m.participants[0]!.hue).toBe("indigo");
  });

  it("invents a participant that was used but not declared", () => {
    const m = parseSequence(`alpha ->> beta : "hi"`);
    expect(m.participants.map((p) => p.id)).toEqual(["alpha", "beta"]);
    expect(m.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("sequence layout", () => {
  const model = parseSequence(SRC);
  const placed = layoutSequence(model, T);

  it("gives every participant a column, left to right in order", () => {
    const xs = model.participants.map((p) => placed.participants[p.id]!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("runs every message down the page in source order", () => {
    const ys = placed.messages.map((m) => Number(/M[\d.-]+,([\d.-]+)/.exec(m.d)![1]));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("closes every activation, including one left open", () => {
    expect(placed.activations.length).toBeGreaterThan(0);
    for (const a of placed.activations) expect(a.y1).toBeGreaterThan(a.y0);
  });

  it("brackets the alt around the lifelines it touches", () => {
    expect(placed.fragments).toHaveLength(1);
    const f = placed.fragments[0]!;
    expect(f.dividers).toHaveLength(1);
    expect(f.tabs.map((t) => t.kind)).toEqual(["alt", "else"]);
    /* The box must span the columns the branches actually talk to. */
    const web = placed.participants.web!;
    expect(f.box.x).toBeLessThan(web.x + web.w);
    expect(f.box.y + f.box.h).toBeGreaterThan(f.box.y);
  });

  it("lays out the same input to the same pixels", () => {
    const again = layoutSequence(parseSequence(SRC), T);
    expect(JSON.stringify(again)).toBe(JSON.stringify(placed));
  });
});
