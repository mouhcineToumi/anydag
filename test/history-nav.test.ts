import { afterEach, describe, expect, it, vi } from "vitest";

import type { BoardTree } from "@/board/useBoard";
import { markHistoryPlace, placeInAddress, resolvePlace, resolvePlaceId, type HistoryPlace } from "@/ui/history";

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
  tags: {},
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

describe("a place is only written on the entry its address names", () => {
  it("is the entry's file while the address names it", () => {
    expect(placeInAddress(place(), "?board=plan&vault=v")).toBe(true);
    expect(placeInAddress({ kind: "note", name: "notes/idea" }, "?note=notes%2Fidea")).toBe(true);
  });

  it("is not the page being left, whose address the pop has already replaced", () => {
    expect(placeInAddress(place(), "?board=other&vault=v")).toBe(false);
    expect(placeInAddress(place(), "?note=notes%2Fidea")).toBe(false);
  });

  it("is no file at all only on an address that names none", () => {
    expect(placeInAddress(null, "?tasks=1&vault=v")).toBe(true);
    expect(placeInAddress(null, "?board=plan")).toBe(false);
  });

  it("leaves the entry a pop made current alone when an effect from the page it left fires", () => {
    /* The entry is A's, as the pop restored it; the effect left over from B fires while the page
       still holds B. Writing B's place here is what made Back read B and stay on A's old address. */
    const writes: { dagHistory: { place: HistoryPlace | null } }[] = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("addEventListener", () => undefined);
    vi.stubGlobal("location", { search: "?board=plan&vault=v" });
    vi.stubGlobal("history", {
      state: { dagHistory: { at: 0, top: 1, place: { kind: "board", name: "plan" } } },
      replaceState: (state: { dagHistory: { place: HistoryPlace | null } }) => void writes.push(state),
    });

    markHistoryPlace({ kind: "board", name: "renamed", id: "id-plan" });
    expect(writes).toHaveLength(0);

    markHistoryPlace({ kind: "board", name: "plan", id: "id-plan" });
    expect(writes.map((state) => state.dagHistory.place)).toEqual([{ kind: "board", name: "plan", id: "id-plan" }]);
  });
});
