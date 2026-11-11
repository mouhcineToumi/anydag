/**
 * What the scope chip offers (`src/assistant/scope.ts`): the vault a chat reaches
 * without a grant, and the open vaults it could be granted.
 *
 * The regression held here is #118: a chat that has none yet was matched against the server's
 * **default** vault — which moves when another vault is opened — so the popover offered the tab's
 * own vault under "Grant another vault…", and granting it was refused ("a chat always reaches its
 * own vault"), which read as Read and Read-and-change doing nothing. A chat that does not exist yet
 * will live in **this tab's** vault, because the first message or grant creates it there.
 */

import { describe, expect, it } from "vitest";

import type { Vault } from "@/vault/api";
import { scopeOf } from "@/assistant/scope";

const vault = (id: string, over: Partial<Vault> = {}): Vault => ({
  id,
  name: id,
  path: `/anywhere/${id}`,
  opened: "",
  open: true,
  default: false,
  missing: false,
  ...over,
});

describe("the vault a chat reaches with no grant", () => {
  it("is the tab's vault for a chat that does not exist yet, even when it is not the server's default", () => {
    const vaults = [vault("localv"), vault("otherly", { name: "otherly", default: true })];
    const view = scopeOf(vaults, "localv", null);
    expect(view.home).toBe("localv");
    expect(view.others.map((v) => v.id)).toEqual(["otherly"]);
  });

  it("is the chat's home once it exists, and its own vault is never offered again", () => {
    const vaults = [vault("localv", { default: true }), vault("otherly")];
    const view = scopeOf(vaults, "localv", { home: "localv" } as never);
    expect(view.home).toBe("localv");
    expect(view.others.map((v) => v.id)).toEqual(["otherly"]);
  });

  it("names the tab's vault off the list, not off the default row", () => {
    const vaults = [vault("localv", { name: "local" }), vault("otherly", { name: "other", default: true })];
    expect(scopeOf(vaults, "localv", null).home).toBe("local");
    expect(scopeOf(vaults, "localv", { home: "localv" } as never).home).toBe("local");
  });

  it("is `This vault` before the vault list has arrived", () => {
    expect(scopeOf(null, "localv", null).home).toBe("This vault");
  });
});

describe("the vaults offered to be granted", () => {
  it("leaves out closed ones", () => {
    const vaults = [vault("localv"), vault("closedly", { open: false }), vault("otherly")];
    expect(scopeOf(vaults, "localv", null).others.map((v) => v.id)).toEqual(["otherly"]);
  });

  it("leaves out one already granted, and names what is granted with its mode", () => {
    const vaults = [vault("localv"), vault("otherly"), vault("thirdly")];
    const view = scopeOf(vaults, "localv", {
      home: "localv",
      "grant:otherly": { mode: "edit", at: "2026-01-01T00:00:00.000Z" },
    } as never);
    expect(view.others.map((v) => v.id)).toEqual(["thirdly"]);
    expect(view.granted).toEqual([{ id: "otherly", name: "otherly", mode: "edit" }]);
  });

  it("keeps a grant taken back out of the list once it is revoked, and counts none then", () => {
    const vaults = [vault("localv"), vault("otherly")];
    const revoked = scopeOf(vaults, "localv", {
      home: "localv",
      "grant:otherly": null,
    } as never);
    expect(revoked.others.map((v) => v.id)).toEqual(["otherly"]);
    expect(revoked.granted).toEqual([]);
  });

  it("is empty when no other vault is open — which the popover says in words", () => {
    expect(scopeOf([vault("localv", { default: true })], "localv", null).others).toEqual([]);
  });
});
