/**
 * What the *app* does, as opposed to what a board says.
 *
 * A board file is the document Claude reads, and every gesture on the canvas is a write to it.
 * These are the other thing: preferences about this window — how big a pasted image lands, how
 * dense an exported PNG is — that no board should carry and that Claude has no business seeing.
 * They live in `localStorage` for the reason `dag:theme` does: a preference remembered in a browser
 * is not part of what a shared `?board=…` link means.
 *
 * Two rules hold the layer:
 *
 * - **Under `?snapshot=1` nothing here is read.** `scripts/snapshot.mjs`, `scripts/tidy.mjs` and
 *   every Playwright check open a board that way, and a picture of a board must be a fact about the
 *   board rather than about whoever last opened it on this machine. It held by accident until now —
 *   a fresh browser context has empty storage — and accident is not a mechanism.
 * - **A setting is read at the moment of the gesture**, never threaded through `Item`. `Item` is
 *   memoised, and a preference reaching it as a prop would re-render every item on the board the
 *   moment somebody changed the export scale.
 *
 * No React here on purpose: `useSettings` is the other file, and this half is plain arithmetic over
 * one string so `test/settings.test.ts` can hold it in Node.
 */

import { storageKey } from "./prefs";
import { markSaved } from "./saved";

/** How wide a pasted or imported image is placed. */
export type PasteSize =
  /** As it looked on the screen it came from: `naturalWidth / devicePixelRatio`. */
  | "screen"
  /** Its own pixels, whatever the screen was. */
  | "pixels"
  /** One fixed width, whatever the image is — what the app did before there were settings. */
  | "width";

/**
 * How loudly the problems dock speaks.
 *
 * Three levels rather than a switch: something that goes
 * away on its own, something that can be put away, or nothing on screen at all.
 */
export type ProblemsShow =
  /** A notification for each new error, which goes away by itself, and the count at the bottom. */
  | "notify"
  /** The count at the bottom only. Nothing pops up. */
  | "badge"
  /** Nothing outside the editor panel, which still lists the open item's problems. */
  | "off";

export type Settings = {
  problems: {
    show: ProblemsShow;
  };
  paste: {
    size: PasteSize;
    /** Used by `size: "width"` alone. */
    width: number;
    /** Wider than this and the image is resampled once, still as a PNG. `null` is "never". */
    maxWidth: number | null;
  };
  export: {
    /** Pixel density of an exported PNG. */
    scale: number;
    /** Whether a board export paints the paper behind it. */
    paper: boolean;
    /** Space around a board export, in grid steps. */
    margin: number;
  };
  /**
   * Which model prompt cards, Rewrite and Generate flashcards ask. Ids only — the dev server holds
   * every key and resolves these against its own table (`plugins/generate/providers.ts`); `null` is
   * "whatever the server's default is", which is what a fresh browser should get.
   */
  llm: {
    provider: string | null;
    model: string | null;
    /**
     * How hard the model should think, for the providers that have a word for it: one of
     * `REASONING`, or `null` for the provider's own setting (Gemini's is `low`, which is what
     * `plugins/generate/providers.ts` measured as the best of speed and drawing).
     */
    reasoning: string | null;
  };
  /**
   * What a new Assistant chat starts on: the harness and the model its first
   * turn runs on. Only a *new* chat reads these — a chat already begun keeps
   * what it was last sent with, and the composer can change that per turn. `null` is whatever can
   * answer here, with that provider's own default model.
   */
  assistant: {
    provider: "claude" | "opencode" | null;
    model: string | null;
  };
};

export const DEFAULTS: Settings = {
  problems: { show: "notify" },
  paste: { size: "screen", width: 520, maxWidth: null },
  export: { scale: 2, paper: true, margin: 4 },
  llm: { provider: null, model: null, reasoning: null },
  assistant: { provider: null, model: null },
};

/** A write to any part of the settings object: one section, or several at once. */
export type SettingsPatch = {
  problems?: Partial<Settings["problems"]>;
  paste?: Partial<Settings["paste"]>;
  export?: Partial<Settings["export"]>;
  llm?: Partial<Settings["llm"]>;
  assistant?: Partial<Settings["assistant"]>;
};

const SECTIONS = ["problems", "paste", "export", "llm", "assistant"] as const;

/** Where they live. One key holding one object, so a bad value is one `catch` and a reset is one `removeItem`. */
export const STORE = "dag:settings";

/** Dispatched on `window` after every write, so an open dialog and the Export caption follow it. */
export const EVENT = "dag:settings";

const SIZES: readonly PasteSize[] = ["screen", "pixels", "width"];
const SHOWS: readonly ProblemsShow[] = ["notify", "badge", "off"];

/**
 * The effort scale every AI surface shows, low to high.
 *
 * Not a contract with any provider: the server maps each level to what that provider accepts —
 * Claude's `--effort`, OpenCode's `#variant`, an HTTP provider's `reasoning_effort` — and a model
 * with no Max (an HTTP provider) takes High instead (`effortFor` in `plugins/generate/llm.ts`).
 */
export const EFFORTS = ["low", "medium", "high", "max"] as const;

/**
 * Every value a stored thinking preference may hold, including `none` from before Max existed.
 * `normalise` reads all of them; the card offers `EFFORTS`, with `null` as Automatic.
 */
export const REASONING = ["none", ...EFFORTS] as const;

/** A short id-like string, or `null`. The server says whether it names anything. */
const ident = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= 200 ? v.trim() : null);

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/**
 * One object in, a whole valid `Settings` out — the half that is worth testing.
 *
 * Every field is taken only when it is the right shape and in range, and falls back to the default
 * otherwise. A key nobody knows is dropped rather than carried: this is a preference file a person
 * may well have hand-edited, and a value the app cannot honour must not be able to make it draw
 * nothing.
 */
export function normalise(raw: unknown): Settings {
  const o = (raw ?? {}) as Partial<Record<keyof Settings, Record<string, unknown>>>;
  const q = o.problems ?? {};
  const p = o.paste ?? {};
  const e = o.export ?? {};
  const l = o.llm ?? {};
  const ast = o.assistant ?? {};
  const max = p.maxWidth;
  return {
    problems: {
      show: SHOWS.includes(q.show as ProblemsShow) ? (q.show as ProblemsShow) : DEFAULTS.problems.show,
    },
    paste: {
      size: SIZES.includes(p.size as PasteSize) ? (p.size as PasteSize) : DEFAULTS.paste.size,
      width: Math.round(num(p.width, 40, 4000, DEFAULTS.paste.width)),
      /* `null` and "no cap" are the same answer, and so is a number too small to be a picture:
         a cap of 8 would turn every screenshot into a smudge, which is the defect this whole
         milestone exists to remove rather than a setting anybody wants. */
      maxWidth: typeof max === "number" && Number.isFinite(max) && max >= 64 ? Math.round(Math.min(8000, max)) : null,
    },
    export: {
      scale: num(e.scale, 1, 4, DEFAULTS.export.scale),
      paper: typeof e.paper === "boolean" ? e.paper : DEFAULTS.export.paper,
      margin: Math.round(num(e.margin, 0, 40, DEFAULTS.export.margin)),
    },
    llm: {
      provider: ident(l.provider),
      model: ident(l.model),
      /* A level the app does not offer is dropped rather than sent: this is a hand-editable file. */
      reasoning: (REASONING as readonly string[]).includes(String(l.reasoning)) ? String(l.reasoning) : null,
    },
    assistant: {
      provider: ast.provider === "claude" || ast.provider === "opencode" ? ast.provider : null,
      model: ident(ast.model),
    },
  };
}

/**
 * Whether this page is a picture being taken.
 *
 * Read off the URL each time rather than cached: `App` rewrites the query with `replaceState` as
 * boards and pages are opened, and a value captured at module load would answer for the URL the tab
 * started with.
 */
export function isSnapshot(): boolean {
  try {
    return new URLSearchParams(location.search).get("snapshot") === "1";
  } catch {
    /* No `location` at all — Node, a worker. Nothing is being photographed either. */
    return false;
  }
}

/** The current settings. `DEFAULTS` for a snapshot, for a browser with site data blocked, and for junk. */
export function readSettings(): Settings {
  if (isSnapshot()) return DEFAULTS;
  try {
    const raw = localStorage.getItem(storageKey(STORE));
    return normalise(raw ? JSON.parse(raw) : null);
  } catch {
    /* A blocked accessor throws, and so does a half-written string. The defaults are still a
       perfectly good answer and it is not worth taking the page down for. */
    return DEFAULTS;
  }
}

/** Merge a patch into what is stored, section by section, and tell the window. */
export function writeSettings(patch: SettingsPatch): Settings {
  const now = readSettings();
  const next = normalise({
    problems: { ...now.problems, ...patch.problems },
    paste: { ...now.paste, ...patch.paste },
    export: { ...now.export, ...patch.export },
    llm: { ...now.llm, ...patch.llm },
    assistant: { ...now.assistant, ...patch.assistant },
  });
  save(JSON.stringify(next));
  announce(now, next, patch);
  return next;
}

/**
 * Say which rows moved, after the write has landed.
 *
 * A patch is section-shaped but a tick is row-shaped, so this walks the fields the patch named and
 * reports only those whose normalised value actually changed. The key is `section.field`, which is
 * what `Field`'s `save` names.
 */
function announce(before: Settings, after: Settings, patch: SettingsPatch): void {
  for (const section of SECTIONS) {
    const changed = patch[section];
    if (!changed) continue;
    const was = before[section] as Record<string, unknown>;
    const now = after[section] as Record<string, unknown>;
    for (const field of Object.keys(changed)) {
      if (was[field] !== now[field]) markSaved(`${section}.${field}`);
    }
  }
}

/**
 * Back to the defaults — the whole key removed, so a later version's new keys are not shadowed by an
 * old object. With `only`, just those sections: each tab of the Settings modal resets what it shows
 * and nothing it does not, so a reset on the export tab cannot quietly change which model
 * draws a prompt card.
 *
 * A reset answers with its own toast rather than a tick per row, so it deliberately does not
 * announce; {@link resetSettingsWithUndo} is the shape the modal uses.
 */
export function resetSettings(only?: readonly (keyof Settings)[]): Settings {
  if (!only) {
    save(null);
    return DEFAULTS;
  }
  const now = readSettings();
  const next = normalise({
    ...now,
    ...Object.fromEntries(only.map((k) => [k, DEFAULTS[k]])),
  });
  save(JSON.stringify(next));
  return next;
}

/**
 * A reset and the action that takes it back.
 *
 * The snapshot is taken *before* the reset and holds only the fields that are away from their
 * default — exactly what the reset will change, and so exactly what Undo has to put back. A field
 * already at its default is not in it, and a change made to that field after the reset is not
 * overwritten when Undo runs. Undo goes through {@link writeSettings}, the same setter the controls
 * use, so it is normalised and announced like any other change.
 */
export function resetSettingsWithUndo(only: readonly (keyof Settings)[]): () => void {
  const before = changedSections(readSettings(), only);
  resetSettings(only);
  return () => {
    writeSettings(before);
  };
}

/** The fields of `only` that are away from their default now, as a patch a write can take. */
function changedSections(now: Settings, only: readonly (keyof Settings)[]): SettingsPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const section of only) {
    const was = now[section] as unknown as Record<string, unknown>;
    const def = DEFAULTS[section] as unknown as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const field of Object.keys(def)) {
      if (was[field] !== def[field]) fields[field] = was[field];
    }
    if (Object.keys(fields).length > 0) patch[section] = fields;
  }
  return patch as SettingsPatch;
}

function save(value: string | null) {
  if (isSnapshot()) return;
  try {
    /* The vault's own copy: `dag:settings@<slug>` outside the default vault. */
    if (value === null) localStorage.removeItem(storageKey(STORE));
    else localStorage.setItem(storageKey(STORE), value);
  } catch {
    /* Remembering is the nicety; honouring it for this session is the point. */
  }
  try {
    dispatchEvent(new Event(EVENT));
  } catch {
    /* No `window`. Nothing is listening either. */
  }
}
