/** Wave A: what the app changes first so sync can sit on it — created, duplicate ids, raw IO, re-keying. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { derivedId, frontId, validId } from "../../server/ids";
import { Session } from "../../server/context";
import { vaultFs } from "../../server/sync/fs";
import { sha1 } from "../../server/vault";
import { mergeKeys, SETTINGS_SETS } from "../../src/settings/merge";
import { BOARD, NOTE, has, makeEnv, readText, sweepTemps, until, write, type Env } from "./helpers";

const envs: Env[] = [];
const env = (o?: Parameters<typeof makeEnv>[0]): Env => {
  const e = makeEnv(o);
  envs.push(e);
  return e;
};
afterEach(async () => {
  for (const e of envs.splice(0)) await e.cleanup();
  sweepTemps();
});

const DUP = (title: string): string => `---\ntitle: ${title}\nid: abcdefghjk\n---\nbody\n`;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("created travels with sync", () => {
  it("adoptCreated before writeRawIf is the indexed created", async () => {
    const e = env();
    e.vault.adoptCreated("n.md", "2020-01-02T03:04:05.000Z");
    expect(e.vault.writeRawIf("n.md", enc(NOTE), null)).toBe(true);
    await e.vault.tree();
    expect(e.home.docByPath(e.vault.id, "n.md")?.created).toBe("2020-01-02T03:04:05.000Z");
    expect(e.vault.createdOf("n.md")).toBe("2020-01-02T03:04:05.000Z");
  });
  it("updates an existing row", async () => {
    const e = env();
    write(e.root, "a.md", NOTE);
    await e.vault.tree();
    e.vault.adoptCreated("a.md", "2019-01-01T00:00:00.000Z");
    expect(e.vault.createdOf("a.md")).toBe("2019-01-01T00:00:00.000Z");
  });
  // Seeds 90, 131 and 797 under load: a document renamed before the index walked its new path was
  // pushed with the new file's birth, the other device adopted that, and a duplicate of its id was
  // then settled differently on the two.
  it("a document renamed before the walk keeps its created; a copy beside its original does not", async () => {
    const e = env();
    const T = "2019-01-01T00:00:00.000Z";
    write(e.root, "a.md", DUP("A"));
    await e.vault.tree();
    e.vault.adoptCreated("a.md", T);
    fs.renameSync(path.join(e.root, "a.md"), path.join(e.root, "b.md"));
    expect(e.vault.createdOf("b.md")).toBe(T);
    await e.vault.tree();
    expect(e.home.docByPath(e.vault.id, "b.md")?.created).toBe(T);
    fs.copyFileSync(path.join(e.root, "b.md"), path.join(e.root, "c.md"));
    expect(e.vault.createdOf("c.md")).not.toBe(T);
  });
  it("so does one sync wrote and the index never walked, renamed twice over", async () => {
    const e = env();
    const T = "2018-06-06T06:06:06.000Z";
    e.vault.adoptCreated("n.md", T);
    expect(e.vault.writeRawIf("n.md", enc(DUP("N")), null)).toBe(true);
    // The same document pulled again under another name, still on disk: not the one renamed.
    e.vault.adoptCreated("x/n.md", T);
    expect(e.vault.writeRawIf("x/n.md", enc(DUP("N")), null)).toBe(true);
    fs.renameSync(path.join(e.root, "n.md"), path.join(e.root, "m.md"));
    expect(e.vault.createdOf("m.md")).toBe(T);
  });
});

describe("duplicate ids", () => {
  const scenario = async (a: string, b: string): Promise<{ kept: string; lost: string; newId: string }> => {
    const e = env();
    write(e.root, "a.md", DUP("A"));
    write(e.root, "b.md", DUP("B"));
    e.vault.adoptCreated("a.md", a);
    e.vault.adoptCreated("b.md", b);
    await e.vault.tree();
    const ia = frontId(readText(e.root, "a.md")) as string;
    const ib = frontId(readText(e.root, "b.md")) as string;
    return ia === "abcdefghjk" ? { kept: "a.md", lost: "b.md", newId: ib } : { kept: "b.md", lost: "a.md", newId: ia };
  };
  it("the earlier created keeps it; the loser gets the derived id, on any device", async () => {
    const r = await scenario("2021-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
    expect(r.kept).toBe("b.md");
    expect(r.newId).toBe(derivedId("abcdefghjk", "a.md"));
    expect(validId(r.newId)).toBe(true);
    const again = await scenario("2021-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
    expect(again).toEqual(r);
  });
  it("equal created: path code-point order decides", async () => {
    const t = "2020-01-01T00:00:00.000Z";
    const r = await scenario(t, t);
    expect(r.kept).toBe("a.md");
    expect(r.newId).toBe(derivedId("abcdefghjk", "b.md"));
  });
  it("derivedId avoids taken ids", () => {
    const first = derivedId("abcdefghjk", "b.md");
    expect(derivedId("abcdefghjk", "b.md", (x) => x === first)).not.toBe(first);
  });
  it("holdFixes keeps the fix out of the file until released", async () => {
    const e = env();
    write(e.root, "a.md", DUP("A"));
    write(e.root, "b.md", DUP("B"));
    e.vault.adoptCreated("a.md", "2020-01-01T00:00:00.000Z");
    e.vault.adoptCreated("b.md", "2021-01-01T00:00:00.000Z");
    e.vault.holdFixes(true);
    await e.vault.tree();
    expect(frontId(readText(e.root, "b.md"))).toBe("abcdefghjk");
    e.vault.holdFixes(false);
    await e.vault.tree();
    expect(frontId(readText(e.root, "b.md"))).toBe(derivedId("abcdefghjk", "b.md"));
    expect(frontId(readText(e.root, "a.md"))).toBe("abcdefghjk");
  });
});

describe("raw IO", () => {
  it("compare-and-set, no minting, folder kept on remove", () => {
    const e = env();
    const v = e.vault;
    expect(v.writeRawIf("x/y.md", enc(NOTE), "nope")).toBe(false);
    expect(v.writeRawIf("x/y.md", enc(NOTE), null)).toBe(true);
    expect(readText(e.root, "x/y.md")).toBe(NOTE);
    expect(v.writeRawIf("x/y.md", enc(NOTE), null)).toBe(true); // identical
    expect(v.writeRawIf("x/y.md", enc("new"), null)).toBe(false);
    expect(v.writeRawIf("x/y.md", enc("new"), "bad")).toBe(false);
    expect(v.writeRawIf("x/y.md", enc("new"), sha1(NOTE))).toBe(true);
    expect(v.removeRawIf("x/y.md", "bad")).toBe(false);
    expect(v.removeRawIf("x/y.md", sha1("new"))).toBe(true);
    expect(has(e.root, "x")).toBe(true);
    expect(v.readRaw("x")).toBeNull();
    expect(v.rmdirRawIfEmpty("x")).toBe(true);
    expect(v.rmdirRawIfEmpty("x")).toBe(false);
    expect(() => v.writeRawIf("../out", enc("x"), null)).toThrow();
  });
});

describe("vaultFs", () => {
  it("scan follows the scope", async () => {
    const e = env();
    write(e.root, "n.md", NOTE);
    write(e.root, "b.board.md", BOARD);
    write(e.root, "attachments/a.pdf", "%PDF");
    write(e.root, ".anydag/settings.json", "{}");
    write(e.root, ".anydag/files/x.json", "{}");
    write(e.root, ".obsidian/x", "1");
    write(e.root, "a.assets/p.png", "png");
    write(e.root, "only/.hidden", "1");
    fs.mkdirSync(path.join(e.root, "empty"));
    const got = await vaultFs(e.vault).scan();
    const files = got
      .filter((x) => x.kind === "file")
      .map((x) => x.rel)
      .sort();
    expect(files).toEqual(
      ["a.assets/p.png", ".anydag/files/x.json", ".anydag/settings.json", "attachments/a.pdf", "b.board.md", "n.md"].sort(),
    );
    expect(files).not.toContain(".anydag/vault.json");
    expect(
      got
        .filter((x) => x.kind === "dir")
        .map((x) => x.rel)
        .sort(),
    ).toEqual(["empty", "only"]);
  });
  it("writeIf is compare-and-set and watch hears .anydag/settings.json", async () => {
    const e = env();
    const f = vaultFs(e.vault);
    expect(await f.writeIf("n.md", enc("a"), null)).toBe(true);
    expect(await f.writeIf("n.md", enc("b"), "stale")).toBe(false);
    expect(await f.writeIf("n.md", enc("b"), sha1("a"))).toBe(true);
    const heard: string[] = [];
    const stop = await f.watch((r) => heard.push(...r));
    write(e.root, ".anydag/settings.json", "{}");
    await until(() => heard.includes(".anydag/settings.json"), 5000, "settings event");
    stop();
  });
  it("the doc channel stays quiet for .anydag/files", async () => {
    const e = env();
    const events: string[] = [];
    const stop = await e.vault.subscribe((c) => events.push(c.type));
    write(e.root, ".anydag/files/q.json", "{}");
    await new Promise((r) => setTimeout(r, 400));
    expect(events).not.toContain("tree");
    stop();
  });
});

describe("rekeyVault", () => {
  it("rows follow, the vault reopens under the new id", async () => {
    const e = env();
    const s = new Session(e.home, e.vault, "t");
    write(e.root, "a.md", NOTE);
    await e.vault.tree();
    const old = e.vault.id;
    e.home.sql("insert into practice (vault, quiz, question, record) values (?, 'q', 'x', '{}')").run(old);
    e.home.set(`digest:${old}:zzz`, "1:abc");
    const next = await s.rekeyVault(old, "0123456789");
    expect(next.id).toBe("0123456789");
    expect(JSON.parse(readText(e.root, ".anydag/vault.json"))).toEqual({ id: "0123456789" });
    expect(e.home.docs("0123456789").length).toBe(1);
    expect(e.home.docs(old).length).toBe(0);
    expect(e.home.sql("select count(*) n from practice where vault = ?").get("0123456789")).toEqual({ n: 1 });
    expect(e.home.get("digest:0123456789:zzz")).toBe("1:abc");
    expect(s.served().map((v) => v.id)).toEqual(["0123456789"]);
    expect(() => s.pick(old)).toThrow();
    await expect(s.rekeyVault("0123456789", "bad")).rejects.toThrow();
    await next.close();
  });
});

describe("mergeKeys", () => {
  it("one side wins when only it changed; theirs wins a clash; removals", () => {
    const base = { a: 1, b: 1, c: 1, d: 1 };
    const out = mergeKeys(base, { a: 2, b: 5, d: 1, e: 1 }, { a: 1, b: 6, c: 1, d: 3, f: 1 });
    expect(out).toEqual({ a: 2, b: 6, d: 3, e: 1, f: 1 });
    expect(Object.keys(out)).toEqual(["a", "b", "d", "e", "f"]);
    expect(mergeKeys(null, { a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });
  it("sets merge", () => {
    const k = SETTINGS_SETS[0];
    const out = mergeKeys(
      { [k]: ["x", "y", "z"] },
      { [k]: ["x", "z", "o"] },
      { [k]: ["y", "x", "z", "t"] },
      { sets: SETTINGS_SETS },
    );
    expect(out[k]).toEqual(["x", "z", "o", "t"]);
  });
});
