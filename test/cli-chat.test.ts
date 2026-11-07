import { describe, expect, it } from "vitest";

import { answerOf, blockLines, conflictLines, grantMode, modeOf, providerOf, rowLines, startOn, stepLines, transcriptLines } from "../cli/commands/chat";
import { UsageError } from "../cli/args";
import type { ChatMeta, ChatRead, ChatRow, Turn, UndoRecord } from "../server/chat/types";

const meta = (over: Partial<ChatMeta> = {}): ChatMeta => ({ v: 1, id: "c1", title: "Plan", created: "2026-11-06T09:00:00Z", home: "v1", provider: "claude", model: "claude-sonnet-5-5", mode: "edit", ...over });

const turn = (over: Partial<Turn> = {}): Turn => ({
  v: 1,
  id: "t1",
  chat: "c1",
  device: "d1",
  at: "2026-11-06T09:01:00Z",
  text: "draw the api",
  provider: "claude",
  model: "claude-sonnet-5-5",
  mode: "edit",
  steps: [],
  blocks: [],
  status: "done",
  ...over,
});

const undo = (over: Partial<UndoRecord>): UndoRecord => ({ v: 1, id: "u1", chat: "c1", turn: "t1", block: "b1", redo: false, device: "d1", at: "", ops: [], conflicts: [], ...over });

describe("flag parsing", () => {
  it("reads modes and providers, and refuses others", () => {
    expect(modeOf(undefined)).toBeUndefined();
    expect(modeOf("edit")).toBe("edit");
    expect(() => modeOf("write")).toThrow(UsageError);
    expect(providerOf("opencode")).toBe("opencode");
    expect(() => providerOf("gpt")).toThrow(UsageError);
  });

  it("reads a grant: ask by default, off is null", () => {
    expect(grantMode(undefined)).toBe("ask");
    expect(grantMode("edit")).toBe("edit");
    expect(grantMode("off")).toBeNull();
    expect(() => grantMode("on")).toThrow(/ask.*edit.*off/);
  });

  it("reads an answer", () => {
    expect(answerOf("yes")).toBe(true);
    expect(answerOf("Y")).toBe(true);
    expect(answerOf("no")).toBe(false);
    expect(() => answerOf("maybe")).toThrow(UsageError);
  });
});

describe("startOn", () => {
  const models = {
    providers: [
      { provider: "claude" as const, available: false, models: [], default: "claude-sonnet-5-5" },
      { provider: "opencode" as const, available: true, models: [], default: "opencode-go/glm-5.3-flash" },
    ],
  };
  it("takes the first available provider and its default model", () => {
    expect(startOn(models)).toEqual({ provider: "opencode", model: "opencode-go/glm-5.3-flash" });
  });
  it("keeps a model that was asked for, and refuses a provider that is not available", () => {
    expect(startOn(models, "opencode", "x/y")).toEqual({ provider: "opencode", model: "x/y" });
    expect(() => startOn(models, "claude")).toThrow(/not available/);
    expect(() => startOn({ providers: [] })).toThrow(/no provider/);
  });
});

describe("rendering", () => {
  it("lists chats newest first", () => {
    const row = (id: string, updated: string, running = false): ChatRow => ({ id, title: id, vault: "v", created: updated, updated, provider: "claude", model: "m", running });
    const lines = rowLines([row("old", "2026-11-01T10:00:00Z"), row("new", "2026-11-06T10:00:00Z", true)]);
    expect(lines[0]).toContain("new");
    expect(lines[0]).toContain("running");
    expect(lines[1]).toContain("old");
  });

  it("draws each step on its own lines, a tool call as one", () => {
    expect(stepLines({ kind: "tool", id: "a", name: "board_read", input: {}, output: "a long answer" })).toEqual(["→ board_read"]);
    expect(stepLines({ kind: "tool", id: "a", name: "board_read", input: {}, error: true })).toEqual(["→ board_read  (failed)"]);
    expect(stepLines({ kind: "approval", id: "b1", what: "write plan", detail: "3 ops", answer: null })).toEqual(["? write plan — 3 ops — waiting for an answer"]);
    expect(stepLines({ kind: "access", id: "b2", vault: "v2", name: "Work", why: "needs the spec", mode: "ask", answer: "yes" })).toEqual(["? reach vault Work (ask): needs the spec — yes"]);
    expect(stepLines({ kind: "error", text: "boom" })).toEqual(["! boom"]);
    expect(stepLines({ kind: "text", text: "a\nb" })).toEqual(["a", "b"]);
  });

  it("marks a block undone by its newest undo record", () => {
    const t = turn({ blocks: [{ id: "b1", title: "Add api", ops: [{} as never, {} as never] }, { id: "b2", title: "", ops: [{} as never] }] });
    expect(blockLines(t, [])).toEqual(["changes:", "  b1  Add api     2 ops", "  b2  (untitled)  1 op"]);
    expect(blockLines(t, [undo({ id: "u1", block: "b1" })])[1]).toContain("undone");
    expect(blockLines(t, [undo({ id: "u1", block: "b1" }), undo({ id: "u2", block: "b1", redo: true })])[1]).not.toContain("undone");
    expect(blockLines(turn(), [])).toEqual([]);
  });

  it("prints a transcript: the person's words, the steps, the changes and the grants", () => {
    const read: ChatRead = {
      chat: meta({ "grant:v2": { mode: "ask", at: "x" }, "grant:v3": null }),
      vault: "v1",
      device: "d1",
      undos: [],
      live: turn({ id: "t2", text: "and a db", status: "running", steps: [{ kind: "text", text: "on it" }] }),
      turns: [turn({ steps: [{ kind: "tool", id: "x", name: "board_write", input: {} }, { kind: "text", text: "done" }], blocks: [{ id: "b1", title: "Add api", ops: [] }] })],
    };
    const text = transcriptLines(read).join("\n");
    expect(text).toContain("# Plan  (c1)");
    expect(text).toContain("reaches v2=ask");
    expect(text).not.toContain("v3");
    expect(text).toContain("## you  2026-11-06 09:01");
    expect(text).toContain("draw the api");
    expect(text).toContain("→ board_write");
    expect(text).toContain("b1  Add api");
    expect(text).toContain("and a db");
    expect(text).toContain("running");
  });

  it("names where a turn came from when it was another device", () => {
    const read: ChatRead = { chat: meta(), vault: "v1", device: "mine", undos: [], live: null, turns: [turn({ device: "laptop" })] };
    expect(transcriptLines(read).join("\n")).toContain("(from laptop)");
  });

  it("says what an undo could not do", () => {
    const r = undo({ conflicts: [{ what: "plan", vault: "v1", paths: ["plan.board.md"], why: "changed" }] });
    expect(conflictLines(r)).toEqual(["conflict: plan (v1) — changed: plan.board.md"]);
    expect(conflictLines(undo({}))).toEqual([]);
  });
});
