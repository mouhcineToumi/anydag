/**
 * The theme and the AI choices were the vault's until #191. They are now the person's, the same in
 * every vault. This file carries a vault's old value across, **once, and never over a value the
 * person already has**.
 *
 * - **The theme.** It used to be `dag:theme@<vault>` in this browser and `dag:theme` in the vault's
 *   bundle. It is now `dag:theme` in the person's bundle.
 * - **The AI choices.** These are the settings object's `llm` and `assistant`. They used to sit
 *   inside the vault's `dag:settings`, and they are now `dag:ai`.
 *
 * Where the old value comes from:
 *
 * - With sync on, it comes from the vault's bundle as the server holds it, because that is the copy
 *   the person last saved.
 * - Otherwise, or when the bundle does not carry the value, it comes from this browser's own copy
 *   for the vault.
 *
 * The first vault opened after the change is the one whose choice carries over. A later vault finds
 * the person's value already set and changes nothing. The vault's own copy is left where it was, so
 * nothing is lost: an older version of the app still reads it there.
 */

import { scopedKey } from "@/vault/current";

import { AI, THEME, readPref, writePref } from "./prefs";
import { DEFAULTS, STORE, normalise, personPart } from "./store";

type Bundle = Record<string, unknown> | null | undefined;

function local(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parsed(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The vault's old theme, if it had one: the bundle's first, then this browser's copy. */
function oldTheme(bundle: Bundle): string | null {
  const fromBundle = bundle?.[THEME];
  if (typeof fromBundle === "string" && fromBundle !== "") return fromBundle;
  return local(scopedKey(THEME));
}

/** The vault's old AI choices, as `dag:ai` would hold them, or `null` when they were the defaults. */
function oldAi(bundle: Bundle): string | null {
  const settings = parsed(bundle?.settings) ?? parsed(local(scopedKey(STORE)));
  if (!settings) return null;
  const choice = personPart(normalise({ llm: settings.llm, assistant: settings.assistant }));
  const same = JSON.stringify(choice) === JSON.stringify(personPart(DEFAULTS));
  return same ? null : JSON.stringify(choice);
}

/**
 * Carry the vault's theme and AI choices over to the person when the person has none yet. Answers
 * whether anything was written, so `sync.ts` can push the person's bundle. Nothing listens for the
 * change yet at this point in the boot.
 */
export function migrateToPerson(bundle?: Bundle): boolean {
  let moved = false;
  if (readPref(THEME) === null) {
    const theme = oldTheme(bundle);
    if (theme) {
      writePref(THEME, theme);
      moved = true;
    }
  }
  if (readPref(AI) === null) {
    const ai = oldAi(bundle);
    if (ai) {
      writePref(AI, ai, "ai");
      moved = true;
    }
  }
  return moved;
}
