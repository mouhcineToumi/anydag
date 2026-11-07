/**
 * Logs, on the page: the person's answer, and the events this page adds to them.
 *
 * The answer is the app's server's (`server/telemetry.ts`), asked once when the page starts and
 * changed with `setConsent`; `useTelemetry` is how the Privacy tab and the first-run card follow it.
 * Events are held here and posted to `POST /api/telemetry/events` every half minute and when the
 * page goes away, and the server cleans them again before keeping any.
 *
 * Load-bearing:
 * - **Nothing is held, listened for or posted unless the answer is yes.** `track` and `fail` return
 *   at once otherwise, and the error listeners are added only on yes.
 * - **Never under `?snapshot=1` or `?view=1`**: a picture of a board, and a page somebody was handed
 *   to read, are not somebody using the app. `startTelemetry` does nothing there, and nothing asks.
 * - **A prop is one of `sync/protocol/logs.ts`'s words, a count or a duration** — the types say so,
 *   and `cleanEvent` runs here too, so a caller that passed anything else has it dropped before it
 *   is ever held.
 */

import { useSyncExternalStore } from "react";

import { desktop } from "@/vault/desktop";

import { cleanEvent, MAX_EVENTS, PAGES, scrub, MESSAGE_MAX, STACK_MAX, type EventName, type LogEvent, type Props } from "../../sync/protocol/logs";

export interface TelemetryStatus {
  consent: boolean | null;
  destination: string | null;
}

/** Dispatched on `window` whenever the answer is known or changes. */
const TELEMETRY_EVENT = "dag:telemetry";

const EVERY_MS = 30_000;
/** A `keepalive` body over 64 KB is refused before it is sent (`docs/architecture/things-that-will-bite.md`). */
const KEEPALIVE_MAX = 60_000;

let status: TelemetryStatus | null = null;
let held: LogEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

function announce(): void {
  try {
    dispatchEvent(new Event(TELEMETRY_EVENT));
  } catch {
    /* no window */
  }
}

/** Whether this page is one nothing is collected on: a picture, or the read-only view. */
function quietPage(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    return q.get("snapshot") === "1" || q.get("view") === "1";
  } catch {
    return true;
  }
}

/** Which kind of page this is, as a log says it — never which document. */
function pageKind(): (typeof PAGES)[number] {
  const q = new URLSearchParams(location.search);
  for (const k of ["board", "note", "quiz", "table", "file", "tasks", "calendar", "quizzes", "trash", "chat"] as const) if (q.has(k)) return k;
  return q.toString() === "" || q.has("vault") ? "home" : "other";
}

export function useTelemetry(): TelemetryStatus | null {
  return useSyncExternalStore(
    (on) => {
      addEventListener(TELEMETRY_EVENT, on);
      return () => removeEventListener(TELEMETRY_EVENT, on);
    },
    () => status,
    () => null,
  );
}

const yes = (): boolean => status?.consent === true;

/** One event, held for the next post. */
export function track(name: EventName, props: Props): void {
  if (!yes()) return;
  const e = cleanEvent({ name, at: new Date().toISOString(), props });
  if (!e) return;
  held.push(e);
  if (held.length > MAX_EVENTS) held.splice(0, held.length - MAX_EVENTS);
}

/** Something that went wrong on this page: its message and stack, both scrubbed here and again on the server. */
export function fail(kind: "error" | "rejection" | "render", e: unknown): void {
  if (!yes()) return;
  const err = e instanceof Error ? e : new Error(typeof e === "string" ? e : "a value that is not an error");
  track("error", {
    where: "page",
    kind,
    message: scrub(`${err.name}: ${err.message}`, MESSAGE_MAX),
    stack: scrub(err.stack ?? "", STACK_MAX),
  });
}

/** Post what is held. `leaving` is the page going away, which wants `keepalive` and nothing large. */
export function flush(leaving = false): void {
  if (!yes() || !held.length) return;
  const events = held;
  held = [];
  const body = JSON.stringify({ events });
  void fetch("/api/telemetry/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    ...(leaving && body.length < KEEPALIVE_MAX ? { keepalive: true } : {}),
  }).catch(() => undefined);
}

const onError = (e: ErrorEvent) => fail("error", e.error ?? e.message);
const onRejection = (e: PromiseRejectionEvent) => fail("rejection", e.reason);
const onHide = () => flush(true);

function listen(on: boolean): void {
  if (on && !timer) {
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
    addEventListener("pagehide", onHide);
    timer = setInterval(() => flush(), EVERY_MS);
  } else if (!on && timer) {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
    removeEventListener("pagehide", onHide);
    clearInterval(timer);
    timer = null;
    held = [];
  }
}

function adopt(next: TelemetryStatus): void {
  const was = yes();
  status = next;
  listen(yes());
  if (yes() && !was && started) opened();
  announce();
}

/** The page's first events: which page, and in what. */
function opened(): void {
  const shell = desktop() ? "desktop" : "browser";
  track("app.open", { page: pageKind(), shell });
  const root = document.documentElement;
  const ready = () => {
    if (root.dataset.dagReady !== "1") return false;
    track("page.ready", { page: pageKind(), ms: performance.now() });
    return true;
  };
  if (ready()) return;
  const watch = new MutationObserver(() => ready() && watch.disconnect());
  watch.observe(root, { attributes: true, attributeFilter: ["data-dag-ready"] });
  setTimeout(() => watch.disconnect(), 60_000);
}

/** Ask the server for the answer, once, when the page starts. */
export async function startTelemetry(): Promise<void> {
  if (started || quietPage()) return;
  started = true;
  try {
    const r = await fetch("/api/telemetry");
    if (!r.ok) return;
    adopt((await r.json()) as TelemetryStatus);
  } catch {
    /* No server: nothing asked, nothing sent. */
  }
}

/** Yes, no, or back to never asked. Answers whether the server took it. */
export async function setConsent(enabled: boolean | null): Promise<boolean> {
  try {
    const r = await fetch("/api/telemetry", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) return false;
    adopt((await r.json()) as TelemetryStatus);
    return true;
  } catch {
    return false;
  }
}
