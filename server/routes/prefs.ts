/**
 * Preferences, which the hosted app kept per account and per workspace and which are files here:
 * the app's in `<home>/settings.json` — the window's layout, the time zone — and the vault's in
 * `<vault>/.anydag/settings.json` — its theme, its settings card, its favourites (decision 11), so a
 * vault synced to another machine opens looking the way it was left.
 *
 * Both are the page's bundle as it sent it: opaque here, `src/settings/store.ts` checks the shape.
 * `null` and `{}` are different answers — never saved, and saved empty — exactly as they were.
 */

import fs from "node:fs";
import path from "node:path";

import type { Session } from "../context";
import { writeAtomic } from "../vault";

export const SETTINGS_MAX = 64 * 1024;

export type Scope = "app" | "vault";

const fileOf = (s: Session, scope: Scope): string =>
  scope === "app" ? path.join(s.home.dir, "settings.json") : path.join(s.vault.root, ".anydag", "settings.json");

/** The bundle, or `null` when nothing was ever saved (or what was is unreadable). */
export function readPrefs(s: Session, scope: Scope): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(fileOf(s, scope), "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function writePrefs(s: Session, scope: Scope, value: Record<string, unknown>): void {
  const file = fileOf(s, scope);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify(value, null, 1)}\n`);
}
