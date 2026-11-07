import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PREF_KEYS,
  CALENDAR_HIDE,
  CALENDAR_VIEW,
  FILE_LIST,
  PREF_KEYS,
  QUIZ_ABOUT,
  QUIZ_MODE,
  SETTINGS_TAB,
  SIDEBAR_FOLDERS,
  STAMP,
  SYNC,
  TASKS_VIEW,
  WEEK_START,
  VAULT_PREF_KEYS,
  VAULT_STAMP,
} from "@/settings/prefs";
import { LOCKED } from "@/settings/lock";
import { STORE } from "@/settings/store";
import { LAST } from "@/vault/current";

/**
 * The preference list, held closed.
 *
 * `PREF_KEYS` is what `sync.ts` sends to the account, so a sixth key added in a component and not
 * here is a preference that silently stops following anybody — it keeps working perfectly on the
 * machine it was set on, which is exactly why nobody would notice. That is the same failure mode
 * `check-skill.mjs` exists for one layer out, and the same answer: read the source for the set, and
 * fail on anything in it that the list does not name.
 *
 * The other three keys are deliberately *not* in `PREF_KEYS`, and each for its own reason:
 * `dag:settings` is the object `store.ts` validates and travels under its own name; `dag:prefs-at` is
 * when this browser last changed something, which is the sync's own bookkeeping; and `dag:sync` says
 * whether this browser syncs at all, which is a fact about the browser and would be absurd to
 * store against a person.
 */

const SRC = path.resolve(__dirname, "../src");

/** Every `dag:`-prefixed string literal in `src/`, which is every storage key and every event. */
function literals(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        for (const m of fs.readFileSync(full, "utf8").matchAll(/"(dag:[a-z0-9:-]+)"/g)) found.add(m[1]!);
      }
    }
  };
  walk(SRC);
  return found;
}

/**
 * The `dag:` names that are events rather than storage.
 *
 * They share the prefix because they share a namespace — which `docs/architecture/things-that-will-bite.md` records as a hazard that
 * has bitten three times — so telling them apart has to be done by hand. Each is dispatched on
 * `window` or `document` and none is ever written to `localStorage`.
 */
const EVENTS = new Set([
  "dag:board",
  "dag:boards",
  /* A note changed: the change feed's event for the second kind of file. */
  "dag:note",
  /* And a quiz, the third. */
  "dag:quiz",
  /* And an attachment, the fourth. */
  "dag:file",
  /* A file dropped on the board was refused — too big, a type this server does not take. */
  "dag:upload-problem",
  /* And a table, the fifth. */
  "dag:table",
  /* An answer reached the server, or the threshold moved: everything that draws Mistakes
     asks again. A window event, because a practice record is not a file and the feed does not carry it. */
  "dag:practice",
  "dag:zoom",
  "dag:view",
  "dag:tidy",
  /* `dag:tidy`'s sibling: a script asking the page for the export the menu would save. */
  "dag:export",
  "dag:links-preview",
  "dag:link-bend",
  "dag:settings",
  "dag:prefs",
  /* The sidebar asking the page for a card it renders — search, settings or feedback.
     Not `dag:settings`, which is the settings-changed event above: one name meaning two things is
     the namespace hazard this list exists to keep visible. */
  "dag:chrome",
  /* A link or a search result pointed the page at one part of a document — the hash
     changed under `replaceState`, which fires no `hashchange` of its own. See `refs/target.ts`. */
  "dag:target",
  /* A share link's live channel: the document changed, or the link stopped opening it.
     Server-sent events on the visitor's own stream, never `dag:note`'s or `dag:board`'s feed. */
  /* A sidebar row let go over a board's canvas: the board page places that file's card. */
  "dag:place-file",
  /* A request was refused because this tab's vault is not there any more: the page goes home. */
  "dag:vault-gone",
  /* A second finger landed on the board: the viewport pinches, and an item a finger was moving lets go. */
  "dag:pinch",
  /* A link that navigates by hand asking the page to open a reference itself rather than load. */
  "dag:follow",
  /* This tab locked or unlocked; another tab hears the key's `storage` event instead. */
  "dag:lock",
  /* Something that writes was refused because the app is locked: the notice says so. */
  "dag:lock-refused",
  /* The trash changed: the change feed's event, and this tab's own after a delete, a
     restore or a delete for good — `onTrash`, `onBoards`' shape. */
  "dag:trash",
  /* Whether this install sends logs, heard or changed (`telemetry/client.ts`): the answer is the
     server's, never stored here. */
  "dag:telemetry",
  /* A sidebar change drawn before the server answers, made or let go: every list redraws. */
  "dag:guessed",
  /* A linked vault's sync status changed: the change feed's event, a `SyncStatus`. */
  "dag:vault-sync",
]);

describe("the preference list", () => {
  it("names every stored key but the keys that are deliberately not preferences", () => {
    const stored = [...literals()].filter((k) => !EVENTS.has(k)).sort();
    const accounted = new Set<string>([...PREF_KEYS, STORE, STAMP, SYNC, SIDEBAR_FOLDERS, TASKS_VIEW, QUIZ_MODE, QUIZ_ABOUT, SETTINGS_TAB, CALENDAR_VIEW, LAST, VAULT_STAMP, FILE_LIST, LOCKED]);
    const loose = stored.filter((k) => !accounted.has(k));
    expect(loose, "a `dag:` key nothing accounts for — add it to PREF_KEYS, or to the note above").toEqual([]);
  });

  it("does not carry its own bookkeeping to the account", () => {
    /* `dag:prefs-at` travels as `at`, and `dag:sync` does not travel at all. In
       `PREF_KEYS` it would be adopted from the account like anything else — which means one
       browser could turn it off for every other browser, with no way back. */
    expect(PREF_KEYS as readonly string[]).not.toContain(STAMP);
    expect(PREF_KEYS as readonly string[]).not.toContain(SYNC);
    expect(PREF_KEYS as readonly string[]).not.toContain(STORE);
    /* Which folders are unfolded is this browser's view, like a scroll position. */
    expect(PREF_KEYS as readonly string[]).not.toContain(SIDEBAR_FOLDERS);
    /* Nor is whether the Tasks page is a list or a board. */
    expect(PREF_KEYS as readonly string[]).not.toContain(TASKS_VIEW);
    /* Nor which half of a quiz's form this browser last used. */
    expect(PREF_KEYS as readonly string[]).not.toContain(QUIZ_MODE);
    /* Nor whether a run's About panel is folded away. */
    expect(PREF_KEYS as readonly string[]).not.toContain(QUIZ_ABOUT);
    /* Nor which tab of the Settings modal was open last. */
    expect(PREF_KEYS as readonly string[]).not.toContain(SETTINGS_TAB);
    /* Nor which view the calendar opens on — but what it shows, and where a week starts, are the
       account's. */
    expect(PREF_KEYS as readonly string[]).not.toContain(CALENDAR_VIEW);
    expect(ACCOUNT_PREF_KEYS as readonly string[]).toContain(CALENDAR_HIDE);
    expect(ACCOUNT_PREF_KEYS as readonly string[]).toContain(WEEK_START);
    /* Nor which vault this browser was in last, which is what a bare `/` resumes, nor the clock
       that dates a vault's bundle — it travels as that bundle's `at`. */
    expect(PREF_KEYS as readonly string[]).not.toContain(LAST);
    expect(PREF_KEYS as readonly string[]).not.toContain(VAULT_STAMP);
    /* Nor whether this browser is locked: a phone stays locked while the
       laptop edits, and a lock that followed the account would lock the laptop too. */
    expect(PREF_KEYS as readonly string[]).not.toContain(LOCKED);
  });

  it("splits into the account's half and the vault's, with nothing in both or neither", () => {
    expect([...ACCOUNT_PREF_KEYS, ...VAULT_PREF_KEYS].sort()).toEqual([...PREF_KEYS].sort());
    expect(ACCOUNT_PREF_KEYS.filter((k) => (VAULT_PREF_KEYS as readonly string[]).includes(k))).toEqual([]);
    /* The settings card and the favourites switch with the vault, and how
       the window is laid out does not. */
    expect([...VAULT_PREF_KEYS].sort()).toEqual(["dag:attachments", "dag:favourites", "dag:theme", "dag:update-links"]);
  });

  it("has no duplicates, because a key adopted twice is a key written twice", () => {
    expect(new Set(PREF_KEYS).size).toBe(PREF_KEYS.length);
  });
});
