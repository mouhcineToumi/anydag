/**
 * Logs: what the app may send about how it is running, and nothing else.
 *
 * One closed vocabulary, read by the three places that touch a log — the page that makes one, the
 * app's server that holds and forwards it (`server/telemetry.ts`), and the sync server that stores
 * it (`sync/server/routes/logs.ts`). Each of them runs the same `cleanBatch` over what it was
 * handed, so a log that left a machine is one this file could describe, whatever sent it.
 *
 * Load-bearing:
 * - **A closed set of events, each with a closed set of props.** A prop is a count, a duration, a
 *   boolean or one word from a list written here; an unknown event or prop is dropped, never kept.
 *   No prop can hold a name, a title, a path or a document's text, because no prop can hold a
 *   string a person typed — the lists are the code's words.
 * - **Two free-text props, and both are scrubbed**: an error's `message` and `stack`. `scrub` takes
 *   out every quoted run (the app quotes the names it reports), every URL and path but a script's
 *   own file name, every email, every file name, every long token that looks like an id or a key.
 *   It runs on every hop, so a sender that forgot is not trusted.
 * - **The install is a random id made when somebody says yes**, and forgotten when they say no:
 *   it counts installs and is nobody's name.
 * - **Plain TypeScript, no imports**, `wire.ts`'s rule: the page, the app's server and the sync
 *   server take it verbatim.
 */

export const LOGS_VERSION = 1;

/** The most events one batch carries; a sender holds the rest for its next. */
export const MAX_EVENTS = 200;
/** The largest batch body the sync server reads at all. */
export const MAX_BATCH_BYTES = 256 * 1024;

export const MESSAGE_MAX = 300;
export const STACK_MAX = 1500;

/** Which page of the app something happened on — a kind of page, never which document. */
export const PAGES = ["board", "note", "quiz", "table", "file", "tasks", "calendar", "quizzes", "trash", "chat", "home", "other"] as const;

/** What is running the page. */
const SHELLS = ["desktop", "browser"] as const;

const OSES = ["linux", "darwin", "win32", "other"] as const;

const ARCHES = ["x64", "arm64", "other"] as const;

/** The fourteen diagram types — held to `DIAGRAM_TYPES` by `test/logs.test.ts`. */
export const DIAGRAM_KINDS = [
  "arch",
  "erd",
  "state",
  "flow",
  "activity",
  "sequence",
  "class",
  "usecase",
  "c4",
  "mindmap",
  "timeline",
  "gitgraph",
  "sketch",
  "chart",
] as const;

/** A thing somebody did, by the feature's name: what is used, never on what. */
const FEATURES = [
  "export.svg",
  "export.png",
  "export.pdf",
  "export.md",
  "export.csv",
  "generate",
  "rewrite",
  "tidy",
  "search",
  "assistant",
  "import",
  "convert",
  "lock",
  "sync.now",
  "quiz.run",
  "upload",
] as const;

const ERROR_WHERE = ["page", "server"] as const;
const ERROR_KINDS = ["error", "rejection", "render", "route"] as const;

/**
 * What a prop may hold. `count` is a whole number ≥ 0, `ms` a duration rounded to a millisecond,
 * `route` a route's *template* (`POST /__board/patch`), a list one of its words, and `text` scrubbed
 * free text — only an error's message and stack.
 */
export type Spec = "count" | "ms" | "bool" | "route" | "text" | readonly string[];

export const EVENTS = {
  /** A page of the app was opened. */
  "app.open": { page: PAGES, shell: SHELLS },
  /** How long a page took to be drawn, from the start of the load. */
  "page.ready": { page: PAGES, ms: "ms" },
  /** A board was opened: how big it is, and how many of each diagram it holds. */
  "board.open": {
    items: "count",
    diagrams: "count",
    pages: "count",
    ...(Object.fromEntries(DIAGRAM_KINDS.map((k) => [k, "count"])) as Record<(typeof DIAGRAM_KINDS)[number], "count">),
  },
  /** A feature was used. */
  "feature.use": { what: FEATURES },
  /** Something went wrong. */
  error: { where: ERROR_WHERE, kind: ERROR_KINDS, message: "text", stack: "text", route: "route" },
  /** How a route answered over the last interval, the app's server's own summary. */
  "route.timing": { route: "route", count: "count", errors: "count", ms: "ms", max: "ms" },
} as const satisfies Record<string, Record<string, Spec>>;

export type EventName = keyof typeof EVENTS;

export type Props = Record<string, number | boolean | string>;

export interface LogEvent {
  name: EventName;
  /** When it happened, an ISO instant to the second. */
  at: string;
  props: Props;
}

/** Who sent a batch, as far as it says anything: no name, no host, no address. */
export interface LogEnv {
  version: string;
  shell: (typeof SHELLS)[number];
  os: (typeof OSES)[number];
  arch: (typeof ARCHES)[number];
  /** A language, `en` or `pt-BR`: the region is a country, and that is as close as it gets. */
  locale: string;
  /** A random id made when somebody said yes. */
  install: string;
}

export interface LogBatch {
  v: typeof LOGS_VERSION;
  env: LogEnv;
  events: LogEvent[];
}

/** `POST /v1/logs`'s answer. */
export interface LogsAccepted {
  accepted: number;
}

const ROUTE = /^(GET|POST|PUT|DELETE|PATCH) \/[A-Za-z0-9_/:.*-]{0,100}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const INSTALL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCRIPT = /([A-Za-z0-9_.-]+\.(?:m?js|cjs|tsx?))((?::\d+){0,2})(?:[?#][^\s]*)?$/;
const FILE_EXT = "md|png|jpe?g|gif|svg|webp|pdf|csv|tsv|json|txt|docx?|xlsx?|pptx?|zip|mp[34]|mov|wav|html?";

/** A script's own file name and position out of a URL or a path, which says where in the code — or `null`. */
function scriptOf(s: string): string | null {
  const m = SCRIPT.exec(s.replace(/[)\]]+$/, ""));
  return m ? `${m[1]}${m[2] ?? ""}` : null;
}

/**
 * Free text with nothing of the person's left in it: what an error's message and stack become
 * before they are kept or sent. Every rule is a *removal*: what a rule cannot recognise as code is
 * replaced rather than guessed at.
 */
export function scrub(raw: string, max: number): string {
  let s = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>");
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`]*/gi, (u) => scriptOf(u) ?? "<url>");
  /* Quoted runs are names, titles and text: the app quotes what it reports. */
  s = s.replace(/`[^`\n]*`|"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’|«[^»\n]*»/g, '"…"');
  /* Anything with a slash in it is a path, but a script's own file. */
  s = s.replace(/(?:[A-Za-z]:)?[^\s()<>"]*[\\/][^\s()<>"]*/g, (p) => {
    const tail = /^(.*?)((?::\d+){1,2})?([)\]]*)$/.exec(p)!;
    const script = scriptOf(tail[1]!);
    return script ? `${script}${tail[2] ?? ""}${tail[3] ?? ""}` : "<path>";
  });
  s = s.replace(new RegExp(`[^\\s()<>"]+\\.(?:${FILE_EXT})\\b`, "gi"), "<file>");
  /* Long tokens with a digit in them: ids, hashes, keys, tokens. */
  s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g, "<id>");
  s = s.replace(/[ \t]{2,}/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function propOf(spec: Spec, v: unknown, key: string): number | boolean | string | undefined {
  if (spec === "count") return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  if (spec === "ms") return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : undefined;
  if (spec === "bool") return typeof v === "boolean" ? v : undefined;
  if (spec === "route") return typeof v === "string" && ROUTE.test(v) ? v : undefined;
  if (spec === "text") return typeof v === "string" ? scrub(v, key === "stack" ? STACK_MAX : MESSAGE_MAX) : undefined;
  return typeof v === "string" && spec.includes(v) ? v : undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isEventName = (v: unknown): v is EventName => typeof v === "string" && Object.prototype.hasOwnProperty.call(EVENTS, v);

/** One event as this file describes it, or `null`: an unknown name, a bad time, no prop left. */
export function cleanEvent(raw: unknown): LogEvent | null {
  if (!isObject(raw) || !isEventName(raw.name)) return null;
  const at = typeof raw.at === "string" ? new Date(raw.at) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const specs = EVENTS[raw.name] as Record<string, Spec>;
  const given = isObject(raw.props) ? raw.props : {};
  const props: Props = {};
  for (const [key, spec] of Object.entries(specs)) {
    const v = propOf(spec, given[key], key);
    if (v !== undefined && v !== "") props[key] = v;
  }
  if (!Object.keys(props).length) return null;
  return { name: raw.name, at: at.toISOString().replace(/\.\d{3}Z$/, "Z"), props };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

/** Who sent it, or `null` when it does not say enough to be counted. */
function cleanEnv(raw: unknown): LogEnv | null {
  if (!isObject(raw)) return null;
  if (typeof raw.install !== "string" || !INSTALL.test(raw.install)) return null;
  if (typeof raw.version !== "string" || !VERSION.test(raw.version)) return null;
  return {
    version: raw.version,
    shell: oneOf(SHELLS, raw.shell, "browser"),
    os: oneOf(OSES, raw.os, "other"),
    arch: oneOf(ARCHES, raw.arch, "other"),
    locale: typeof raw.locale === "string" && LOCALE.test(raw.locale) ? raw.locale : "und",
    install: raw.install,
  };
}

/** A whole batch, every event cleaned and the unknown dropped — or `null` when nothing is left. */
export function cleanBatch(raw: unknown): LogBatch | null {
  if (!isObject(raw) || raw.v !== LOGS_VERSION || !Array.isArray(raw.events)) return null;
  const env = cleanEnv(raw.env);
  if (!env) return null;
  const events = raw.events.slice(0, MAX_EVENTS).map(cleanEvent).filter((e): e is LogEvent => e !== null);
  return events.length ? { v: LOGS_VERSION, env, events } : null;
}

/** A locale as `cleanEnv` keeps it: the language, and a region when there is one. */
export function localeOf(raw: string | undefined): string {
  const m = /^([a-z]{2,3})(?:[-_]([A-Za-z]{2}))?/i.exec(raw ?? "");
  return m ? `${m[1]!.toLowerCase()}${m[2] ? `-${m[2].toUpperCase()}` : ""}` : "und";
}
