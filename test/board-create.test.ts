import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boardCall, createFile, createFolder } from "@/board/useBoard";

/**
 * A create's refusal carries its reason.
 *
 * `/create` and `/mkdir` used to answer `null` for every non-2xx and every dropped connection, so
 * the sidebar had nothing to put under the tree and a locked or angry server looked like a dead
 * button. `boardCall` says what happened; these hold that, and that a folder made for real still
 * tells the list to redraw.
 */

const heard: string[] = [];
const target = new EventTarget();
const record = (e: Event) => heard.push(e.type);

const answer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  heard.length = 0;
  Object.defineProperty(globalThis, "dispatchEvent", {
    configurable: true,
    value: (e: Event) => target.dispatchEvent(e),
  });
  target.addEventListener("dag:boards", record);
});

afterEach(() => {
  target.removeEventListener("dag:boards", record);
  Reflect.deleteProperty(globalThis, "dispatchEvent");
  vi.unstubAllGlobals();
});

describe("a create the server refuses", () => {
  it("answers the server's own words rather than a bare null, and redraws nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ error: "`x` is not a folder name" }, 400)),
    );
    expect(await createFolder("x")).toEqual({ error: "`x` is not a folder name" });
    expect(heard).toEqual([]);
  });

  it("says the same for a file's `/create`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ error: "the vault is full" }, 400)),
    );
    expect(await createFile("board", "untitled")).toEqual({ error: "the vault is full" });
  });

  it("has a sentence of its own when the server gives no reason, and when it does not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({}, 500)),
    );
    expect(await createFolder("x")).toEqual({ error: "The server could not do that. Try again." });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await createFile("note", "x")).toEqual({ error: "The server did not answer. Try again." });
  });
});

describe("a create that lands", () => {
  it("answers what it made, and tells the list to redraw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/mkdir") ? answer({ folder: "Untitled" }) : answer({ name: "Untitled" }))),
    );
    expect(await createFolder("Untitled")).toEqual({ folder: "Untitled" });
    expect(await createFile("note", "Untitled")).toEqual({ name: "Untitled" });
    expect(heard).toEqual(["dag:boards"]);
  });

  it("hands boardCall's body back as it answered it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ name: "plan", extra: 1 })),
    );
    expect(await boardCall<{ name?: string; extra?: number }>("rename", { name: "draft" })).toEqual({
      ok: true,
      data: { name: "plan", extra: 1 },
    });
  });
});
