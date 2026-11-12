/**
 * Talking to `/api/vaults`, `/api/vault/settings` and `/__board/transfer` — plain functions over
 * `fetch`, with the list kept here as a tiny store `useVaults` subscribes to.
 *
 * **Nothing here removes a folder from disk.** Closing a vault stops serving it; forgetting takes it
 * off the recent list. The folder is the person's.
 */

import type { FileKind } from "@/board/useBoard";

import { LAST, currentVault, scopedKey } from "./current";

/** One vault on the recent list, as the server says it. */
export interface Vault {
  id: string;
  name: string;
  path: string;
  opened: string;
  /** Being served now. */
  open: boolean;
  /** What a request naming no vault is about. */
  default: boolean;
  /** The folder is not there any more. */
  missing: boolean;
}

/** What moving a folder took across, by kind. */
export interface Removed {
  boards: string[];
  notes: string[];
  quizzes: string[];
  tables?: string[];
  files?: string[];
  folders: string[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : `that did not work (${r.status})`);
  return data as T;
}

// -- the list ----------------------------------------------------------------

let list: Vault[] | null = null;
let homeDir = "";
const listeners = new Set<() => void>();

function set(next: Vault[], home?: string): void {
  list = next;
  if (home !== undefined) homeDir = home;
  for (const l of listeners) l();
}

/** The recent vaults as last fetched, newest first; `null` before the first answer. */
export const vaultsNow = (): Vault[] | null => list;

/** The person's home folder on the machine the server is on — where a new vault is offered. */
export const homeNow = (): string => homeDir;

export function subscribeVaults(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Ask again. Called before the first render and whenever the switcher opens. */
export async function loadVaults(): Promise<Vault[] | null> {
  try {
    const got = await call<{ vaults: Vault[]; home: string }>("/api/vaults");
    set(got.vaults, got.home);
    return list;
  } catch {
    return list;
  }
}

/** The one this tab is in, from the list; a placeholder before the list has come. */
export function currentOf(all: readonly Vault[] | null): Vault {
  const id = currentVault();
  return (
    all?.find((v) => v.id === id) ?? {
      id,
      name: "Vault",
      path: "",
      opened: "",
      open: Boolean(id),
      default: false,
      missing: false,
    }
  );
}

// -- changing them ------------------------------------------------------------

/** Open a folder as a vault (or bring an open one forward). The folder is made a vault by being opened. */
export async function openVault(path: string): Promise<Pick<Vault, "id" | "name" | "path">> {
  const { vault } = await call<{ vault: Pick<Vault, "id" | "name" | "path"> }>("/api/vaults/open", { path });
  await loadVaults();
  return vault;
}

/** Make `name` under `parent` and open it. */
export async function createVault(parent: string, name: string): Promise<Pick<Vault, "id" | "name" | "path">> {
  const { vault } = await call<{ vault: Pick<Vault, "id" | "name" | "path"> }>("/api/vaults/create", { parent, name });
  seed(currentVault(), vault.id);
  await loadVaults();
  return vault;
}

/** Stop serving a vault; with `forget`, take it off the recent list too. The folder stays. */
export async function closeVault(id: string, forgetIt = false): Promise<void> {
  const got = await call<{ vaults: Vault[] }>("/api/vaults/close", { id, forget: forgetIt || undefined });
  if (forgetIt) forget(id);
  set(got.vaults);
}

/**
 * Move a file — or with `folder`, a folder and everything in it — from this tab's vault to another
 * open one. Resolves where it landed; a file whose name was taken there comes back numbered.
 */
export async function transferFile(kind: FileKind, name: string, to: string): Promise<string> {
  return (await call<{ name: string }>("/__board/transfer", { name, kind, to })).name;
}

export async function transferFolder(folder: string, to: string): Promise<Removed & { folder: string }> {
  return call<Removed & { folder: string }>("/__board/transfer", { folder, to });
}

// -- the preferences kept in a vault ---------------------------------------------

/** The preferences in this tab's vault, or `null` when there are none yet. */
export async function fetchVaultSettings(): Promise<Record<string, unknown> | null> {
  const data = await call<{ settings: Record<string, unknown> | null }>("/api/vault/settings");
  return data.settings ?? null;
}

export async function saveVaultSettings(settings: Record<string, unknown>): Promise<void> {
  await fetch("/api/vault/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
}

// -- what this browser keeps per vault -----------------------------------------

/**
 * The keys a new vault starts with a copy of: its settings, never its favourites. The theme is not
 * one: it is the person's in every vault (#191), so there is nothing to copy.
 */
const SEEDED = ["dag:settings"];

/** A new vault starts with the look of the one it was made from; written into this browser's cache. */
function seed(from: string, to: string): void {
  try {
    for (const key of SEEDED) {
      const value = localStorage.getItem(scopedKey(key, from));
      if (value !== null) localStorage.setItem(scopedKey(key, to), value);
    }
  } catch {
    /* Site data blocked: the new vault starts from the defaults, which is survivable. */
  }
}

/** Everything this browser kept for a vault taken off the list, and the memory of having been in it. */
function forget(id: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.endsWith(`@${id}`)) localStorage.removeItem(key);
    }
    if (localStorage.getItem(LAST) === id) localStorage.removeItem(LAST);
  } catch {
    /* Nothing to tidy that anything would read. */
  }
}
