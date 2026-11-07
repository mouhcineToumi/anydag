/** Shared scaffolding for the vault tests: a temp vault, a temp home, and a polling wait. */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Home } from "../../server/home";
import { frontId } from "../../server/ids";
import { Vault, type Change } from "../../server/vault";

export const BOARD = "---\ntitle: t\n---\n\n```md {#one}\nhi\n```\n";
export const NOTE = "---\ntitle: Onboarding\n---\n# Onboarding\n\nA paragraph.\n";
export const QUIZ = "---\ntitle: Drill\n---\n\n## One? {#q1}\n- [x] y\n- [ ] n\n\n## Two?\n- [ ] y\n- [x] n\n";
export const TABLE = "---\ntitle: Deals\n---\n\n## Deals {#deals}\n\n| Name {#name} |\n| --- |\n| Acme {#racme} |\n";
export const PDF = Buffer.from("%PDF-1.4\n% an attachment\n");

export interface Env {
  root: string;
  homeDir: string;
  home: Home;
  vault: Vault;
  /** Open a fresh Home (and a Vault on the same folder) — "the SQLite file was deleted". */
  reopen(opts?: { freshHome?: boolean }): Env;
  cleanup(): Promise<void>;
}

const made: string[] = [];

/** A temp vault folder and a temp home, closed and removed by `cleanup`. */
export function makeEnv(opts: { types?: readonly string[] } = {}): Env {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-vault-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-home-"));
  made.push(root, homeDir);
  return build(root, homeDir, opts);
}

function build(root: string, homeDir: string, opts: { types?: readonly string[] }): Env {
  const home = new Home(homeDir);
  const vault = new Vault(root, home, opts);
  const env: Env = {
    root,
    homeDir,
    home,
    vault,
    reopen(o = {}) {
      void vault.close();
      home.close();
      let dir = homeDir;
      if (o.freshHome) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-home-"));
        made.push(dir);
      }
      return build(root, dir, opts);
    },
    async cleanup() {
      await vault.close();
      try {
        home.close();
      } catch {
        /* already closed by reopen */
      }
      for (const p of [root, homeDir]) fs.rmSync(p, { recursive: true, force: true });
    },
  };
  return env;
}

/** Remove every temp dir a `reopen` made on top of the two `cleanup` knows. */
export function sweepTemps(): void {
  for (const p of made.splice(0)) fs.rmSync(p, { recursive: true, force: true });
}

export const write = (root: string, rel: string, data: string | Uint8Array): string => {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  return abs;
};

export const readText = (root: string, rel: string): string => fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
export const has = (root: string, rel: string): boolean => fs.existsSync(path.join(root, ...rel.split("/")));
export const idIn = (text: string): string | null | false => frontId(text);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll until `fn` returns something truthy, or fail after `ms`. */
export async function until<T>(fn: () => T | Promise<T>, ms = 5000, what = "condition"): Promise<NonNullable<T>> {
  const stop = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got as NonNullable<T>;
    if (Date.now() > stop) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

/** A subscription that remembers what it heard. */
export async function listen(
  vault: Vault,
): Promise<{ events: Change[]; stop: () => void; docs: (name: string) => Extract<Change, { type: "doc" }>[] }> {
  const events: Change[] = [];
  const stop = await vault.subscribe((c) => events.push(c));
  return {
    events,
    stop,
    docs: (name) => events.filter((e): e is Extract<Change, { type: "doc" }> => e.type === "doc" && e.name === name),
  };
}
