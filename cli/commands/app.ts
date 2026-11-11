import {
  CALENDAR_HIDE,
  FAVOURITES,
  ATTACHMENTS,
  LIBRARY,
  SIDEBAR,
  THEME,
  WEEK_START,
  VAULT_PREF_KEYS,
} from "../../src/settings/prefs";
import { DEFAULTS, normalise, type Settings } from "../../src/settings/store";

import { UsageError, pairs } from "../args";
import { emit, table, type Command, type Ctx } from "../context";

/**
 * What the app does rather than what a board says: the account's preferences, and telling somebody
 * something is broken.
 *
 * **Each copy is one bundle, and it is written whole.** A browser adopting one *removes* every
 * preference the bundle does not carry (`prefs.ts`'s `adoptAll`), so a write that sent only the key
 * it changed would reset the rest of somebody's setup the next time they opened a tab. And it
 * carries `at`, which is what a browser compares against its own last change: stamped now, so the
 * page adopts this on its next load rather than pushing its older copy over it.
 *
 * **Two bundles since vaults**: the account's holds how the window is laid out, and
 * the vault's — the one `--vault` names — holds the settings object, the theme and the
 * favourites. The page's split, in `settings/prefs.ts`, and this reads it from there.
 */

interface Bundle {
  settings?: unknown;
  at?: number;
  [pref: string]: unknown;
}

async function readBundle(ctx: Ctx): Promise<Bundle | null> {
  const got = await ctx.api.get<{ settings: Bundle | null }>("/api/settings");
  return got.settings;
}

/** The vault's bundle — its theme, favourites and settings object; empty until something is written. */
async function readVaultBundle(ctx: Ctx): Promise<Bundle> {
  const got = await ctx.api.get<{ settings: Bundle | null }>("/api/vault/settings");
  return got.settings ?? {};
}

/** The preferences the card and the sidebar hold, by the name a person would use. */
const PREFS: Record<string, string> = {
  theme: THEME,
  library: LIBRARY,
  sidebar: SIDEBAR,
  favourites: FAVOURITES,
  /* The vault's attachments folder, relative to its root. */
  attachments: ATTACHMENTS,
  /* The calendar's two, the account's in every vault — what Settings' Calendar tab shows. */
  "calendar.weekStart": WEEK_START,
  "calendar.hide": CALENDAR_HIDE,
};

/** The kinds the calendar can hide, as `dag:calendar-hide` stores them. */
const CAL_KINDS = ["task", "event", "note"];

const SETTINGS_KEYS = [
  "problems.show",
  "paste.size",
  "paste.width",
  "paste.maxWidth",
  "export.scale",
  "export.paper",
  "export.margin",
  "llm.provider",
  "llm.model",
  "llm.reasoning",
] as const;

function flatten(s: Settings): Record<string, unknown> {
  return {
    "problems.show": s.problems.show,
    "paste.size": s.paste.size,
    "paste.width": s.paste.width,
    "paste.maxWidth": s.paste.maxWidth,
    "export.scale": s.export.scale,
    "export.paper": s.export.paper,
    "export.margin": s.export.margin,
    "llm.provider": s.llm.provider,
    "llm.model": s.llm.model,
    "llm.reasoning": s.llm.reasoning,
  };
}

const THEMES = ["paper", "paper-dark", "neutral"];

export const APP: Command[] = [
  {
    name: ["telemetry"],
    group: "app",
    args: "[on|off|ask]",
    summary: "whether this install sends anonymous logs, and where — or turn it on, off, or back to asking",
    help:
      "Off until somebody says yes: the app asks once, on the first page it opens. Logs hold errors with every " +
      "name, path and quoted text taken out, which features are used, how fast pages draw, and the app's version " +
      "and system — never a document, a title, a file name or anything that names a person. `ask` puts it back to " +
      "never answered, so the app asks again. They go to ANYDAG_LOGS_URL, else the sync server a vault is paired with.",
    routes: ["GET /api/telemetry", "PUT /api/telemetry"],
    async run(ctx, p) {
      type Status = { consent: boolean | null; destination: string | null };
      const said = p.pos[0];
      const asked: Record<string, boolean | null> = { on: true, off: false, ask: null };
      let status: Status;
      if (said === undefined) status = await ctx.api.get<Status>("/api/telemetry");
      else {
        if (!(said in asked)) throw new UsageError(`\`${said}\` is not on, off or ask`);
        status = await ctx.api.put<Status>("/api/telemetry", { enabled: asked[said] });
      }
      emit(ctx, status, () => {
        ctx.io.out(status.consent === null ? "not asked yet" : status.consent ? "on" : "off");
        ctx.io.err(
          status.destination
            ? `logs go to ${status.destination}`
            : "no destination: no sync server is paired and ANYDAG_LOGS_URL is not set",
        );
      });
    },
  },
  {
    name: ["settings"],
    group: "app",
    args: "[<key=value>...]",
    summary: "this account's preferences, and the vault's; key=value changes them, key= puts one back to its default",
    help:
      `Keys: theme (${THEMES.join(", ")}), favourites (a comma list of file names), ${SETTINGS_KEYS.join(", ")}. ` +
      "Those are the vault's, the one --vault names; library, sidebar, calendar.weekStart (0 for Sunday " +
      "to 6 for Saturday; Monday, 1, when unset) and calendar.hide (a comma list of task, event, note: what the calendar leaves " +
      "out) are the account's. " +
      "A value the page could not honour is put back to its default, the way the page itself reads one. An open " +
      "tab keeps what it has until it is next loaded.",
    routes: ["GET /api/settings", "PUT /api/settings", "GET /api/vault/settings", "PUT /api/vault/settings"],
    async run(ctx, p) {
      const account: Bundle = { ...((await readBundle(ctx)) ?? {}) };
      const space: Bundle = { ...(await readVaultBundle(ctx)) };
      /* Which bundle a preference is kept in: the vault's for the theme and the favourites. */
      const home = (key: string): Bundle => ((VAULT_PREF_KEYS as readonly string[]).includes(key) ? space : account);
      /* The legacy vault half is not written back into the account's bundle: it lives in the
         vault's now, and the page reads it from there. */
      for (const key of ["settings", ...VAULT_PREF_KEYS]) delete account[key];
      const bundle = space;
      let accountChanged = false;
      const given = pairs(p.pos);
      if (Object.keys(given).length > 0) {
        const settings = normalise(bundle.settings) as unknown as Record<string, Record<string, unknown>>;
        for (const [key, v] of Object.entries(given)) {
          if (key in PREFS) {
            let value = v === null ? null : String(v);
            if (key === "theme" && value !== null && !THEMES.includes(value))
              throw new UsageError(`a theme is one of ${THEMES.join(", ")}`);
            if (key === "calendar.weekStart" && value !== null) {
              if (!/^[0-6]$/.test(value)) throw new UsageError("calendar.weekStart is 0 (Sunday) to 6 (Saturday)");
              /* Monday is the default and is stored as nothing, as the page stores it. */
              if (value === "1") value = null;
            }
            if (key === "calendar.hide" && value !== null) {
              const kinds = value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const wrong = kinds.find((k) => !CAL_KINDS.includes(k));
              if (wrong) throw new UsageError(`calendar.hide is a comma list of ${CAL_KINDS.join(", ")} — not \`${wrong}\``);
              value = kinds.length ? [...new Set(kinds)].sort().join(",") : null;
            }
            if (key === "favourites" && value !== null) {
              const names = value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const listed = await ctx.api.get<{
                boards: string[];
                notes: string[];
                quizzes?: string[];
                tables?: string[];
                files?: string[];
              }>("/__board/list");
              value = JSON.stringify(
                names.map((n) => {
                  if (listed.boards.includes(n)) return `board:${n}`;
                  if (listed.notes.includes(n)) return `note:${n}`;
                  if (listed.quizzes?.includes(n)) return `quiz:${n}`;
                  if (listed.tables?.includes(n)) return `table:${n}`;
                  if (listed.files?.includes(n)) return `file:${n}`;
                  throw new UsageError(`no board, note, quiz, table or file \`${n}\``);
                }),
              );
            }
            const into = home(PREFS[key]!);
            if (into === account) accountChanged = true;
            if (value === null) delete into[PREFS[key]!];
            else into[PREFS[key]!] = value;
            continue;
          }
          if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
            throw new UsageError(`no setting \`${key}\` — ${[...Object.keys(PREFS), ...SETTINGS_KEYS].join(", ")}`);
          }
          const [group, field] = key.split(".") as [string, string];
          const fallback = (DEFAULTS as unknown as Record<string, Record<string, unknown>>)[group]![field];
          settings[group]![field] = v === null ? fallback : v === "null" ? null : v === "true" ? true : v === "false" ? false : v;
        }
        bundle.settings = normalise(settings);
        /* Said rather than silent: a value the page would not honour comes back as the default, and
           somebody who typed `paste.size=bogus` should hear that it did not take. */
        const landed = flatten(bundle.settings as Settings);
        for (const [key, v] of Object.entries(given)) {
          if (key in landed && v !== null && String(landed[key]) !== String(v)) {
            ctx.io.err(`note: ${key}=${v} is not a value the page takes — it is ${String(landed[key])}`);
          }
        }
        /* The vault's bundle is written whatever changed: in a default vault nobody has
           opened since vaults, it is the only place the settings moved out of the account's
           bundle below are kept. */
        bundle.at = Date.now();
        await ctx.api.put("/api/vault/settings", { settings: bundle });
        if (accountChanged) {
          account.at = Date.now();
          await ctx.api.put("/api/settings", { settings: account });
        }
      }
      const flat = flatten(normalise(bundle.settings));
      const prefs = Object.fromEntries(Object.entries(PREFS).map(([k, key]) => [k, home(key)[key] ?? null]));
      /* Favourites are stored as a JSON list of `kind:name`; a person reads them as names. */
      if (typeof prefs.favourites === "string") {
        try {
          prefs.favourites = (JSON.parse(prefs.favourites) as string[])
            .map((f) => f.replace(/^(board|note|quiz|table|file):/, ""))
            .join(", ");
        } catch {
          /* Left as stored. */
        }
      }
      emit(ctx, { ...prefs, ...flat }, () => {
        const shown = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
        for (const line of table([...Object.entries(prefs), ...Object.entries(flat)].map(([k, v]) => [k, shown(v)])))
          ctx.io.out(line);
      });
    },
  },
];
