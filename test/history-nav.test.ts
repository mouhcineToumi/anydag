import { afterEach, describe, expect, it, vi } from "vitest";

import type { BoardTree } from "@/board/useBoard";
import { resolvePlace, resolvePlaceId, type HistoryPlace } from "@/ui/history";

/**
 * A history entry names a file in the address and carries its id in the state. What a pop does
 * with it — stay, follow a rename, skip a trashed file — is decided off the listing, and this is
 * that decision without a browser.
 */

const tree = (over: Partial<BoardTree> = {}): BoardTree => ({
  loaded: true,
  fresh: true,
  boards: ["plan", "renamed"],
  folders: [],
  notes: ["notes/idea"],
  titles: {},
  tasks: {},
  projects: {},
  events: {},
  created: {},
  ids: { plan: "id-plan", renamed: "id-plan", "notes/idea": "id-note" },
  quizzes: [],
  questions: {},
  tables: [],
  files: [],
  sizes: {},
  ...over,
});

const place = (over: Partial<HistoryPlace> = {}): HistoryPlace => ({ kind: "board", name: "plan", ...over });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what a history entry's file is now", () => {
  it("is the same entry while the name is where it was", () => {
    expect(resolvePlace(place({ id: "id-plan" }), tree({ boards: ["plan"], ids: { plan: "id-plan" } }))).toEqual({
      state: "same",
    });
  });

  it("follows a rename by the id the address cannot carry", () => {
    expect(resolvePlace(place({ id: "id-plan" }), tree({ boards: ["renamed"], ids: { renamed: "id-plan" } }))).toEqual({
      state: "moved",
      place: { kind: "board", name: "renamed", id: "id-plan" },
    });
  });

  it("is gone when a fresh listing does not name the id at all", () => {
    expect(resolvePlace(place({ id: "id-plan" }), tree({ boards: [], ids: {} }))).toEqual({ state: "gone" });
  });

  it("reads an entry with no id by its name, and calls a name that is not there gone", () => {
    expect(resolvePlace(place(), tree())).toEqual({ state: "same" });
    expect(resolvePlace(place({ name: "trashed" }), tree())).toEqual({ state: "gone" });
  });

  it("waits for a listing that has not answered rather than deciding on a kept one", () => {
    expect(resolvePlace(place({ id: "id-plan" }), tree({ fresh: false }))).toEqual({ state: "wait" });
  });
});

describe("asking the server about an id the listing does not name", () => {
  it("answers null for an id nothing holds, which is a trashed file", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    await expect(resolvePlaceId("id-plan")).resolves.toBeNull();
  });

  it("answers the file the id names now", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ id: "id-plan", kind: "note", name: "notes/idea" }), { status: 200 }),
    );
    await expect(resolvePlaceId("id-plan")).resolves.toEqual({ kind: "note", name: "notes/idea" });
  });

  it("throws for an answer about the server rather than the file", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(resolvePlaceId("id-plan")).rejects.toThrow("503");
  });
});
