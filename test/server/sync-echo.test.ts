import { describe, expect, it } from "vitest";

import { Echoes, FOLDER } from "../../server/sync/echo";

const yes = async (): Promise<boolean> => true;
const no = async (): Promise<boolean> => false;

describe("Echoes: what sync last left at a path (#36)", () => {
  it("is nothing for a path sync never wrote", async () => {
    expect(await new Echoes().heard("a.md", yes)).toBe(false);
  });

  it("hands the note to the check and believes its answer", async () => {
    const e = new Echoes();
    e.note("a.md", "sha");
    e.note("d", FOLDER);
    const asked: unknown[] = [];
    expect(
      await e.heard("a.md", async (left) => {
        asked.push(left);
        return true;
      }),
    ).toBe(true);
    expect(await e.heard("d", async (left) => left === FOLDER)).toBe(true);
    expect(asked).toEqual(["sha"]);
  });

  it("keeps the note for a second report of the same write (#486)", async () => {
    // A file in a folder made just now is said by the vault's watcher and again by the folder's own.
    const e = new Echoes();
    e.note("deep/er/a.md", "sha");
    expect(await e.heard("deep/er/a.md", yes)).toBe(true);
    expect(await e.heard("deep/er/a.md", yes)).toBe(true);
  });

  it("is spent by the first event that disagrees, so it never outlives a write after it", async () => {
    const e = new Echoes();
    e.note("a.md", "sha");
    expect(await e.heard("a.md", no)).toBe(false);
    expect(await e.heard("a.md", yes)).toBe(false);
  });

  it("keeps a note sync renewed while the disk was being read", async () => {
    const e = new Echoes();
    e.note("a.md", "old");
    expect(
      await e.heard("a.md", async () => {
        e.note("a.md", "new");
        return false;
      }),
    ).toBe(false);
    expect(await e.heard("a.md", async (left) => left === "new")).toBe(true);
  });

  it("lapses after thirty seconds", async () => {
    let t = 0;
    const e = new Echoes(() => t);
    e.note("a.md", "sha");
    t = 30_000;
    expect(await e.heard("a.md", yes)).toBe(true);
    t = 30_001;
    expect(await e.heard("a.md", yes)).toBe(false);
  });
});
