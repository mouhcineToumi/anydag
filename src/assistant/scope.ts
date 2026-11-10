/**
 * What the scope chip and its popover show: the vault the chat reaches
 * without a grant, what it has been granted, and the open vaults it could be granted — held here
 * rather than inside the component so a test can hold it in Node (`test/assistant-scope.test.ts`).
 *
 * **The vault a chat reaches with no grant is its home, and a chat that has none yet will live in
 * the tab's vault**, because the first message or grant makes it there (`Surface.ensure` posts the
 * tab's vault with the create). It is *not* the server's default vault — that is "the vault opened
 * last" and moves whenever another tab or the CLI opens a folder, so a page that reached for it
 * once offered the tab's own vault under "Grant another vault…", and the grant was refused with
 * "a chat always reaches its own vault" — which read as buttons that did nothing.
 */

import type { Vault } from "@/vault/api";

import { grantsOf, type ChatMeta, type Mode } from "./types";

/** One granted vault, named for the person, with what it may do. */
interface ScopeGrant {
  id: string;
  name: string;
  mode: Mode;
}

/** What the scope chip and its popover draw, one answer for both. */
export interface ScopeView {
  /** The name of the vault the chat reaches with no grant. */
  home: string;
  /** What the chat has been granted, named, so the chip's `+n` and the popover's rows agree. */
  granted: ScopeGrant[];
  /** Open vaults the chat does not reach yet, so nothing offered is a grant it already has. */
  others: { id: string; name: string }[];
}

export function scopeOf(vaults: readonly Vault[] | null, current: string, meta: ChatMeta | null): ScopeView {
  const named = (id: string): string => vaults?.find((v) => v.id === id)?.name ?? "another vault";
  const mine = meta ? meta.home : current;
  const home = mine ? (vaults?.find((v) => v.id === mine)?.name ?? "This vault") : "This vault";
  const granted = meta ? Object.entries(grantsOf(meta)).map(([id, g]) => ({ id, name: named(id), mode: g.mode })) : [];
  const given = new Set(granted.map((g) => g.id));
  return {
    home,
    granted,
    others: (vaults ?? []).filter((v) => v.open && v.id !== mine && !given.has(v.id)).map((v) => ({ id: v.id, name: v.name })),
  };
}
