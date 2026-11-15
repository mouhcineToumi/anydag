import { describe, expect, it } from "vitest";

import type { ChatRead, Step, Turn } from "../src/assistant/types";
import { EMPTY, reduce } from "../src/assistant/useChat";

const turn = (steps: Step[]): Turn => ({
  v: 1,
  id: "t1",
  chat: "c1",
  device: "d",
  at: "2026-11-15T00:00:00.000Z",
  text: "hi",
  provider: "claude",
  model: "m",
  steps,
  blocks: [],
  status: "running",
});

const read = (live: Turn): ChatRead => ({
  chat: { v: 1, id: "c1", title: "hi", created: live.at, home: "v", provider: "claude", model: "m" },
  vault: "v",
  turns: [],
  undos: [],
  live,
  device: "d",
});

const tool: Step = { kind: "tool", id: "x", name: "board_create", input: {} };
const ask: Step = { kind: "approval", id: "b1", what: "Change something other than “Plan”?", detail: "Make flow", answer: null };

describe("the chat the page holds", () => {
  it("keeps a step the stream brought after the read's snapshot, whichever answered first", () => {
    /* The stream: the turn, its tool call, then the approval it is waiting on. */
    let s = reduce(EMPTY, { t: "event", e: { type: "turn", turn: turn([]) } });
    s = reduce(s, { t: "event", e: { type: "step", turn: "t1", index: 0, step: tool } });
    s = reduce(s, { t: "event", e: { type: "step", turn: "t1", index: 1, step: ask } });
    /* The read, taken before the approval was asked, answers last. */
    s = reduce(s, { t: "loaded", read: read(turn([tool])) });
    expect(s.live?.steps).toEqual([tool, ask]);
  });

  it("takes the read's steps where it has them", () => {
    let s = reduce(EMPTY, { t: "event", e: { type: "turn", turn: turn([]) } });
    s = reduce(s, { t: "event", e: { type: "step", turn: "t1", index: 0, step: ask } });
    const answered: Step = { ...ask, answer: "yes" } as Step;
    s = reduce(s, { t: "loaded", read: read(turn([answered, tool])) });
    expect(s.live?.steps).toEqual([answered, tool]);
  });
});
