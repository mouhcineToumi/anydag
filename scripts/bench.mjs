#!/usr/bin/env node
/**
 * What AnyDag costs to run, and where it stops working (#261).
 *
 * One run generates synthetic vaults in a temp folder of its own, starts the real server bundle on
 * each with a throwaway `ANYDAG_HOME`, drives the built page in Chromium and, where it is built, the
 * Electron shell, and prints one line per measurement. Nothing outside that temp folder is read or
 * written but the built bundles, and the folder is removed by its exact path when the run ends.
 *
 *   node scripts/bench.mjs [--quick] [--guard] [--sizes 100,1000,10000,50000] [--only <groups>]
 *                          [--json <file>] [--keep]
 *
 *   --quick   small steps only (vaults of 100 and 1k files, boards of 10 and 100 items, diagrams of
 *             50 and 200 nodes, attachments of 1 and 10 MB): a few minutes; the whole run is ~25
 *   --guard   only the nightly guards, each against its ceiling in `scripts/bench-guard.json`;
 *             exit 1 when one is over (see *The guards* below)
 *   --sizes   the vault sizes, in files (default 100,1000,10000,50000)
 *   --only    a comma list of groups: vault, page, board, attach, leak, desktop (default all)
 *   --json    also write every measurement, with the machine, to this file
 *   --keep    leave the temp folder in place and say where it is
 *
 * Needs the built page and server (`npm run build && node server/build.mjs`); the `desktop` group
 * also needs `node desktop/build.mjs` and a display, and is skipped with a line saying so without
 * them. Per-process memory and CPU are read from `/proc` on Linux and from `ps` on macOS; on Windows
 * those lines say `n/a`.
 *
 * **The output.** A header names the machine; then one line per measurement:
 *
 *   <metric>  <value> <unit>  [# note]
 *
 * `<metric>` is dotted, group first — `vault.10000.index.cold`, `board.500.ready`, `desktop.rss.main`.
 * A value is a number, or `n/a` when this platform cannot measure it, or `timeout` when the step did
 * not finish inside its limit (that is a measurement: it is where something breaks). Units: `ms`,
 * `s`, `MB`, `%` (of one core, averaged over the window the note names), `count`. `--json` writes
 * `{ machine, started, args, results: [{ metric, value, unit, note }] }`.
 *
 * **What is measured, and how.**
 * - *vault.<n>*: the server started on a vault of n files (90% notes, 4% tasks among them, boards,
 *   tables, quizzes and small attachments, in folders of 50 plus a flat `inbox/` holding a tenth):
 *   time to listen, the first and a warm `GET /__board/list`, `/index`, a cold and a warm
 *   `/search`, the server's RSS, the app home's size, idle CPU with the change feed open, and a burst
 *   of 200 external writes (CPU, events heard, time to quiet). And that opening wrote nothing: every
 *   file's size and mtime before and after, `.anydag/` included (the vault is generated with its id).
 * - *page.<n>*: the built page in Chromium on the same vault: a note in `inbox/` opened to
 *   `data-dag-ready`, the sidebar's rows drawn, the page's JS heap and DOM, idle CPU of the browser,
 *   and the search card's first and next answer.
 * - *board.*: boards of 10, 100, 500 and 2000 items, `arch` diagrams of 50, 200, 500 and 1000 nodes
 *   (ELK, in its worker), and notes of 1k and 100k words, each loaded to `data-dag-ready` three times
 *   (median and max; `data-dag-ready` already waits for the fonts and the re-layout they cause), the
 *   heap and DOM of each board, and its idle CPU on a fresh page loaded once (a tab reloaded three
 *   times spends the next tens of seconds in GC of the old documents, which is not the board's).
 * - *attach.*: attachments of 1, 10, 100 and 500 MB uploaded and read back, with the server's peak
 *   RSS after each, and one over the 512 MB limit.
 * - *leak.*: the server's RSS across 30 rounds of list, index and search, and across 100 change-feed
 *   connections opened and dropped.
 * - *desktop.*: the Electron shell (`desktop/dist/main.cjs`) on the 1k vault: time to the first
 *   window and to `data-dag-ready`, `app.getAppMetrics()` per process plus the server child,
 *   idle CPU per process, and a request's cost through `anydag://` (`desktop/forward.ts`) against
 *   the same request straight to the server; then startup at every vault size, a first launch on a
 *   fresh app home and a second on the same one, to the first window and to a board drawn. Runs
 *   with a temp `HOME`, so the shim it writes on launch lands in the temp folder.
 *
 * **The guards** (`--guard`) are two cheap numbers the nightly holds: the server's idle CPU with the
 * change feed open on a 1k-file vault, and the time to `data-dag-ready` of a 200-node `arch`
 * diagram. Each ceiling in `bench-guard.json` is about twice what a GitHub runner measures, so it
 * fails on a 2x regression and not on a slow runner.
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { storageState } from "./session.mjs";

const require = createRequire(import.meta.url);
const { chromium, _electron } = require("@playwright/test");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(root, "server", "dist", "anydag-server.mjs");
const PAGE = path.join(root, "dist", "index.html");
const DESKTOP = path.join(root, "desktop", "dist", "main.cjs");

/* -- arguments ------------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
const opt = (name, dflt) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : dflt;
};
const QUICK = argv.includes("--quick");
const GUARD = argv.includes("--guard");
const KEEP = argv.includes("--keep");
const JSON_OUT = opt("--json", null);
const SIZES = opt("--sizes", QUICK ? "100,1000" : "100,1000,10000,50000")
  .split(",")
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0);
const ONLY = new Set(opt("--only", "vault,page,board,attach,leak,desktop").split(","));
const BOARD_ITEMS = QUICK ? [10, 100] : [10, 100, 500, 2000];
const DIAGRAM_NODES = QUICK ? [50, 200] : [50, 200, 500, 1000];
const ATTACH_MB = QUICK ? [1, 10] : [1, 10, 100, 500];
/** Any one step: past this it is `timeout`, which is where that thing breaks. */
const STEP_MS = 300_000;

for (const [file, what] of [
  [SERVER, "node server/build.mjs"],
  [PAGE, "npm run build"],
]) {
  if (!fs.existsSync(file)) {
    console.error(`bench: ${path.relative(root, file)} is missing — run \`${what}\` first`);
    process.exit(2);
  }
}

/* -- the temp folder, and the only cleanup ------------------------------------------------------ */

/* Everything this run makes is under `work`, and `work` is the only path anything is removed by.
   It is checked to be a folder this run made in the system's temp folder before it goes: a cleanup
   that removes by a name it did not make is how `boards/local/` was once emptied. */
const TMP = fs.realpathSync(os.tmpdir());
const work = fs.mkdtempSync(path.join(TMP, "anydag-bench-"));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (KEEP) {
    console.log(`# kept ${work}`);
    return;
  }
  const ok =
    typeof work === "string" &&
    path.dirname(work) === TMP &&
    path.basename(work).startsWith("anydag-bench-") &&
    path.basename(work).length > "anydag-bench-".length;
  if (!ok) {
    console.error(`bench: refusing to remove \`${work}\`, which is not this run's temp folder`);
    return;
  }
  fs.rmSync(work, { recursive: true, force: true });
}
const live = new Set();
async function shutdown(code) {
  for (const stop of [...live]) await stop().catch(() => undefined);
  cleanup();
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

/* -- output ------------------------------------------------------------------------------------- */

const results = [];
function record(metric, value, unit, note = "") {
  const v = value === null || value === undefined ? "n/a" : typeof value === "number" ? round(value) : value;
  results.push({ metric, value: v, unit, note });
  console.log(`${metric.padEnd(40)} ${`${v} ${unit}`.padEnd(16)}${note ? `  # ${note}` : ""}`);
}
const round = (n) =>
  Math.abs(n) >= 100 ? Math.round(n) : Math.abs(n) >= 1 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
const mb = (bytes) => (bytes === null ? null : bytes / 1024 / 1024);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

/* -- the machine -------------------------------------------------------------------------------- */

function machine() {
  const cpus = os.cpus();
  let distro = "";
  try {
    distro = /PRETTY_NAME="([^"]*)"/.exec(fs.readFileSync("/etc/os-release", "utf8"))?.[1] ?? "";
  } catch {
    /* not Linux */
  }
  return {
    cpu: cpus[0]?.model?.trim() ?? "?",
    cores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.type()} ${os.release()}${distro ? ` (${distro})` : ""}`,
    arch: process.arch,
    node: process.version,
    disk: (() => {
      try {
        return execFileSync("df", ["-h", "--output=source,fstype", TMP], { encoding: "utf8" }).trim().split("\n").pop();
      } catch {
        return "?";
      }
    })(),
  };
}

/* -- one process's memory and CPU ------------------------------------------------------------------ */

const LINUX = process.platform === "linux";
const TICK = (() => {
  if (!LINUX) return 100;
  try {
    return Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
  } catch {
    return 100;
  }
})();

/** `{ rss, peak }` in bytes, or nulls where this platform cannot say. */
function memOf(pid) {
  if (LINUX) {
    try {
      const s = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0) * 1024;
      return { rss: kb("VmRSS"), peak: kb("VmHWM") };
    } catch {
      return { rss: null, peak: null };
    }
  }
  if (process.platform === "darwin") {
    try {
      const kb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
      return { rss: kb * 1024, peak: null };
    } catch {
      return { rss: null, peak: null };
    }
  }
  return { rss: null, peak: null };
}

/** CPU seconds the process has used, user and system, or null. */
function cpuOf(pid) {
  if (LINUX) {
    try {
      const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
      return (Number(f[11]) + Number(f[12])) / TICK;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    try {
      const t = execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim();
      const parts = t.split(":").map(Number);
      return parts.reduce((acc, p) => acc * 60 + p, 0);
    } catch {
      return null;
    }
  }
  return null;
}

/** Every process under `pid`, itself included, with its command line (Linux only). */
function treeOf(pid) {
  if (!LINUX) return [{ pid, cmd: "" }];
  const parent = new Map();
  for (const e of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const s = fs.readFileSync(`/proc/${e}/stat`, "utf8");
      parent.set(Number(e), Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]));
    } catch {
      /* gone */
    }
  }
  const out = [pid];
  for (let i = 0; i < out.length; i++) for (const [p, pp] of parent) if (pp === out[i]) out.push(p);
  return out.map((p) => {
    let cmd = "";
    try {
      cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch {
      /* gone */
    }
    return { pid: p, cmd };
  });
}

/** Percent of one core the processes used over `ms`. */
async function cpuOver(pids, ms) {
  const before = pids.map(cpuOf);
  await sleep(ms);
  const after = pids.map(cpuOf);
  if (before.some((x) => x === null) || after.some((x) => x === null)) return null;
  const used = after.reduce((a, x, i) => a + (x - before[i]), 0);
  return (used / (ms / 1000)) * 100;
}

function duBytes(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

/* -- synthetic vaults --------------------------------------------------------------------------- */

/** A seeded generator, so two runs write the same vault. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = `system ledger harbour payment settle queue worker index search vault note board diagram
layout render canvas window server client token request answer change feed watcher folder file
attachment table quiz task project event calendar trash snapshot export import theme colour metric
font measure width height group edge node card lane column row label legend title draft review
release build check gate test spec branch merge commit history version cache memory process thread
signal timer budget limit growth latency throughput account invoice customer order shipment parcel
warehouse route schedule meeting agenda decision outcome risk owner deadline milestone roadmap`
  .split(/\s+/)
  .filter(Boolean);
const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";

function words(r, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]);
  return out.join(" ");
}
function idOf(r) {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHA[Math.floor(r() * 32)];
  return s;
}
function paragraph(r, n) {
  const w = words(r, n);
  return `${w[0].toUpperCase()}${w.slice(1)}.`;
}

/** A note of about `n` words: headings, paragraphs, a list, links to its neighbours. */
function noteText(r, n, front, links) {
  const parts = [];
  let left = n;
  let h = 1;
  while (left > 0) {
    parts.push(`## ${paragraph(r, 3).slice(0, -1)} ${h++}`);
    const p = Math.min(left, 60 + Math.floor(r() * 40));
    parts.push(paragraph(r, p));
    left -= p;
    if (r() < 0.3) parts.push(["- ", "- ", "- "].map((d) => d + words(r, 5)).join("\n"));
  }
  if (links.length) parts.push(links.map((l) => `[[${l}]]`).join(" · "));
  return `---\n${front}---\n\n${parts.join("\n\n")}\n`;
}

/** An `arch` fence body of `n` nodes: groups of ten, a chain in each, and edges across. */
function archBody(r, n) {
  const lines = [];
  const groups = Math.ceil(n / 10);
  const kinds = ["service", "store", "queue", "client", "external"];
  for (let g = 0; g < groups; g++) {
    lines.push(`group g${g} "Group ${g}" {`);
    for (let i = g * 10; i < Math.min(n, (g + 1) * 10); i++) {
      lines.push(`  ${kinds[i % kinds.length]} n${i} "${paragraph(r, 2).slice(0, -1)}" "${words(r, 2)}"`);
    }
    lines.push("}");
  }
  for (let i = 1; i < n; i++) if (i % 10 !== 0) lines.push(`n${i - 1} --> n${i}`);
  for (let g = 1; g < groups; g++) lines.push(`n${(g - 1) * 10} --> n${g * 10} "${words(r, 1)}"`);
  for (let k = 0; k < Math.floor(n / 5); k++) {
    const a = Math.floor(r() * n);
    const b = Math.floor(r() * n);
    if (a !== b) lines.push(`n${a} --> n${b}`);
  }
  return lines.join("\n");
}

/** A board of `n` items on a grid: nine in ten text cards, one in ten a six-node diagram. */
function boardText(r, n, title) {
  const out = [`---\ntitle: ${title}\nid: ${idOf(r)}\n---\n`];
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 480;
    const y = Math.floor(i / cols) * 400;
    if (i % 10 === 9) out.push(`\`\`\`arch {#d${i} x=${x} y=${y}}\n${archBody(r, 6)}\n\`\`\`\n`);
    else out.push(`\`\`\`md {#c${i} x=${x} y=${y} w=360}\n### ${paragraph(r, 3)}\n\n${paragraph(r, 30)}\n\`\`\`\n`);
  }
  return out.join("\n");
}

const pad = (n, w = 6) => String(n).padStart(w, "0");

/**
 * A vault of `n` files. Its `.anydag/vault.json` is written here, as a vault already opened once
 * has one, so that opening it must write nothing at all.
 */
function makeVault(dir, n, seed = 1) {
  const r = rng(seed);
  fs.mkdirSync(path.join(dir, ".anydag"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".anydag", "vault.json"), `${JSON.stringify({ id: idOf(r) }, null, 1)}\n`);
  const inbox = Math.max(1, Math.floor(n / 10));
  const names = [];
  let made = 0;
  const write = (rel, text) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    made++;
  };
  for (let i = 0; made < n; i++) {
    const folder =
      i < inbox ? "inbox" : `area-${pad(Math.floor((i - inbox) / 500), 2)}/topic-${pad(Math.floor((i - inbox) / 50), 4)}`;
    const roll = r();
    const stem = `${folder}/item-${pad(i)}`;
    /* Half the notes carry an id, as files the app made do; half have none, as an imported vault's. */
    const id = r() < 0.5 ? `id: ${idOf(r)}\n` : "";
    if (roll < 0.04) {
      const due = `2026-${pad(1 + Math.floor(r() * 12), 2)}-${pad(1 + Math.floor(r() * 28), 2)}`;
      write(`${stem}.md`, noteText(r, 80, `title: Task ${i}\n${id}status: todo\ndue: ${due}\n`, []));
    } else if (roll < 0.06) {
      write(`${stem}.board.md`, boardText(r, 4, `Board ${i}`));
    } else if (roll < 0.07) {
      write(
        `${stem}.table.md`,
        `---\ntitle: Table ${i}\n---\n\n| Name | Amount | Done |\n|---|---|---|\n${Array.from({ length: 20 }, () => `| ${words(r, 2)} | ${Math.floor(r() * 1000)} | ${r() < 0.5 ? "yes" : "no"} |`).join("\n")}\n`,
      );
    } else if (roll < 0.08) {
      write(`attachments/file-${pad(i)}.txt`, `${words(r, 200)}\n`);
    } else {
      const links = names.length ? [names[Math.floor(r() * names.length)]] : [];
      write(`${stem}.md`, noteText(r, 150 + Math.floor(r() * 300), `title: Note ${i}\n${id}`, links));
      names.push(`item-${pad(i)}`);
    }
  }
  return { inbox, id: JSON.parse(fs.readFileSync(path.join(dir, ".anydag", "vault.json"), "utf8")).id };
}

/** Every file under `dir` as `path → size:mtime`, so a write anywhere shows. */
function fingerprint(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        out.set(path.relative(dir, p), `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out;
}
function changed(a, b) {
  const out = [];
  for (const [k, v] of b) if (a.get(k) !== v) out.push(k);
  for (const k of a.keys()) if (!b.has(k)) out.push(k);
  return out;
}

/* -- the server --------------------------------------------------------------------------------- */

async function startServer(vault, home, { page = true } = {}) {
  fs.mkdirSync(home, { recursive: true });
  const token = randomBytes(24).toString("base64url");
  const args = [SERVER, vault, "--port", "0"];
  if (!page) args.push("--no-page");
  const env = { ...process.env, ANYDAG_HOME: home, ANYDAG_TOKEN: token, ANYDAG_CLOUD: "off" };
  delete env.ANYDAG_VAULT;
  const t0 = now();
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stderr.on("data", (c) => {
    said += c;
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not listen in ${STEP_MS} ms: ${said}`)), STEP_MS);
    child.stdout.on("data", (c) => {
      said += c;
      const m = /open http:\/\/127\.0\.0\.1:(\d+)\//.exec(said);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("exit", (code) => reject(new Error(`the server left (${code}): ${said}`)));
  });
  const startMs = now() - t0;
  const origin = `http://127.0.0.1:${port}`;
  const stop = async () => {
    live.delete(stop);
    if (child.exitCode !== null) return;
    const gone = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await Promise.race([gone, sleep(10_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  live.add(stop);
  /** A request with the token, its body read whole, timed. */
  const req = async (p, init = {}) => {
    const t = now();
    const res = await fetch(origin + p, {
      ...init,
      headers: { ...(init.headers ?? {}), "x-anydag-token": token },
      signal: AbortSignal.timeout(STEP_MS),
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { ms: now() - t, status: res.status, bytes: body.length, json: () => JSON.parse(body.toString("utf8")) };
  };
  return { child, pid: child.pid, port, token, origin, startMs, req, stop };
}

/** Time a request; `timeout` when it does not answer inside the step limit. */
async function timedReq(s, p, init) {
  try {
    const r = await s.req(p, init);
    if (r.status >= 400) return { ms: null, status: r.status, bytes: r.bytes };
    return r;
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") return { ms: "timeout" };
    throw e;
  }
}

/**
 * The change feed, held open the way a page holds it, so the watcher runs. Resolves once the stream
 * has said it is open; `events` counts what it has said since.
 */
async function openFeed(s) {
  const ctl = new AbortController();
  const res = await fetch(`${s.origin}/__board/events`, { headers: { "x-anydag-token": s.token }, signal: ctl.signal });
  const feed = { events: 0, last: now(), close: () => ctl.abort() };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let opened;
  const open = new Promise((r) => {
    opened = r;
  });
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        if (text.includes(": open")) opened();
        const n = (text.match(/^event: /gm) ?? []).length;
        if (n) {
          feed.events += n;
          feed.last = now();
        }
      }
    } catch {
      /* closed */
    }
  })();
  await open;
  return feed;
}

/* -- Chromium ------------------------------------------------------------------------------------- */

async function launchBrowser() {
  const candidates = [process.env.ANYDAG_CHROMIUM, undefined, "/opt/pw-browsers/chromium"].filter(
    (c, i, all) => all.indexOf(c) === i,
  );
  let last;
  for (const executablePath of candidates) {
    try {
      const server = await chromium.launchServer(executablePath ? { executablePath } : {});
      const browser = await chromium.connect(server.wsEndpoint());
      const stop = async () => {
        live.delete(stop);
        await browser.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      };
      live.add(stop);
      return { browser, pid: server.process()?.pid ?? null, stop };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function pageOn(b, s, size = { width: 1440, height: 900 }) {
  const context = await b.browser.newContext({ viewport: size, storageState: storageState(s.token) });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  return { context, page, metrics, problems };
}

/** Time from navigation to `data-dag-ready`, or `timeout`. */
async function readyAfter(page, url, timeout = STEP_MS) {
  const t = now();
  await page.goto(url, { timeout });
  try {
    await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout, polling: 50 });
  } catch {
    return "timeout";
  }
  return now() - t;
}

/** The Chromium processes and which of them render a page. */
function chromiumProcs(pid) {
  if (!pid) return { all: [], renderers: [] };
  const all = treeOf(pid);
  return { all: all.map((p) => p.pid), renderers: all.filter((p) => p.cmd.includes("--type=renderer")).map((p) => p.pid) };
}
const sumRss = (pids) => {
  let total = 0;
  for (const p of pids) {
    const m = memOf(p).rss;
    if (m === null) return null;
    total += m;
  }
  return total;
};

/* -- the groups ----------------------------------------------------------------------------------- */

/** One vault size: the server's half, and the page's on the same server. */
async function vaultGroup(n, b) {
  const dir = path.join(work, `vault-${n}`);
  const home = path.join(work, `home-${n}`);
  let t = now();
  const v = makeVault(dir, n);
  record(`vault.${n}.generate`, now() - t, "ms", `${(duBytes(dir) / 1024 / 1024).toFixed(1)} MB on disk`);
  const before = fingerprint(dir);
  const s = await startServer(dir, home);
  const p = `vault.${n}`;
  record(`${p}.server.start`, s.startMs, "ms", "spawn to listening, the vault opened");
  record(`${p}.server.rss.start`, mb(memOf(s.pid).rss), "MB");

  const list1 = await timedReq(s, "/__board/list");
  record(`${p}.list.cold`, list1.ms, "ms", `${mb(list1.bytes)?.toFixed(1)} MB answer; walks the vault and fills the index`);
  const list2 = await timedReq(s, "/__board/list");
  record(`${p}.list.warm`, list2.ms, "ms");
  const idx1 = await timedReq(s, "/__board/index");
  record(`${p}.index.cold`, idx1.ms, "ms", "every text parsed in the grammar worker");
  const idx2 = await timedReq(s, "/__board/index");
  record(`${p}.index.warm`, idx2.ms, "ms");
  const s1 = await timedReq(s, "/__board/search?q=ledger");
  record(`${p}.search.cold`, s1.ms, "ms", "corpus parsed, engine built");
  const warm = [];
  for (const q of ["harbour sett", "milestone", "queue worker", "zzzz"]) {
    const r = await timedReq(s, `/__board/search?q=${encodeURIComponent(q)}`);
    warm.push(r.ms);
  }
  record(
    `${p}.search.warm`,
    warm.includes("timeout") ? "timeout" : median(warm.filter((x) => typeof x === "number")),
    "ms",
    "median of 4 queries",
  );
  const m = memOf(s.pid);
  record(`${p}.server.rss.used`, mb(m.rss), "MB", "after list, index and search");
  record(`${p}.server.rss.peak`, mb(m.peak), "MB");
  const homeBytes = duBytes(home);
  record(`${p}.home.size`, mb(homeBytes), "MB", "the app home: SQLite index and its WAL");

  const feed = await openFeed(s);
  await sleep(2_000);
  record(`${p}.idle.cpu`, await cpuOver([s.pid], 15_000), "%", "server, change feed open, 15 s");

  const after = fingerprint(dir);
  const wrote = changed(before, after);
  record(
    `${p}.open.writes`,
    wrote.length,
    "count",
    wrote.length ? `wrote ${wrote.slice(0, 3).join(", ")}` : "opening wrote nothing",
  );

  /* A burst of external writes, the way an agent or a sync tool lands them: up to 200 notes
     rewritten as fast as `fs` goes. */
  const targets = [...after.keys()].filter((k) => /\/item-\d+\.md$/.test(k)).slice(0, 200);
  const cpu0 = cpuOf(s.pid);
  const events0 = feed.events;
  t = now();
  for (const rel of targets) fs.appendFileSync(path.join(dir, rel), `\nEdited by the bench at ${Date.now()}.\n`);
  const wroteMs = now() - t;
  while (now() - Math.max(feed.last, t + wroteMs) < 1_500 && now() - t < 60_000) await sleep(100);
  const quiet = feed.last - t;
  const cpu1 = cpuOf(s.pid);
  record(`${p}.burst.events`, feed.events - events0, "count", `${targets.length} files written in ${Math.round(wroteMs)} ms`);
  record(`${p}.burst.settle`, quiet, "ms", "first write to the last event the feed said");
  record(`${p}.burst.cpu`, cpu0 === null ? null : cpu1 - cpu0, "s", "server CPU for the burst");
  const idx3 = await timedReq(s, "/__board/index");
  record(`${p}.index.after-burst`, idx3.ms, "ms", "only what changed is parsed again");
  record(`${p}.home.size.after-burst`, mb(duBytes(home)), "MB");
  feed.close();

  if (b && ONLY.has("page")) await pageGroup(n, s, v, b);
  await s.stop();
}

async function pageGroup(n, s, v, b) {
  const p = `page.${n}`;
  const { context, page, metrics, problems } = await pageOn(b, s);
  try {
    const note = "inbox/item-000000";
    const ready = await readyAfter(page, `${s.origin}/?note=${encodeURIComponent(note)}`);
    record(`${p}.note.ready`, ready, "ms", "a note in inbox/ opened cold to data-dag-ready");
    const rows = v.inbox;
    let t = now();
    let drawn = "timeout";
    try {
      await page.waitForFunction((want) => document.querySelectorAll("[data-dag-sidebar-row]").length >= want, rows, {
        timeout: STEP_MS,
        polling: 100,
      });
      drawn = now() - t + (typeof ready === "number" ? ready : 0);
    } catch {
      /* drawn stays timeout */
    }
    record(`${p}.sidebar.drawn`, drawn, "ms", `from navigation to ${rows} rows of inbox/ in the sidebar`);
    const counted = await page.evaluate(() => ({
      rows: document.querySelectorAll("[data-dag-sidebar-row]").length,
      nodes: document.getElementsByTagName("*").length,
    }));
    record(`${p}.sidebar.rows`, counted.rows, "count");
    record(`${p}.dom.nodes`, counted.nodes, "count");
    const m = await metrics();
    record(`${p}.heap`, mb(m.JSHeapUsedSize), "MB", "the page's JS heap");
    const procs = chromiumProcs(b.pid);
    record(`${p}.rss.renderer`, mb(sumRss(procs.renderers)), "MB", "every renderer of the browser (one page open)");
    record(`${p}.rss.browser`, mb(sumRss(procs.all)), "MB", "every Chromium process");
    await sleep(2_000);
    const task0 = (await metrics()).TaskDuration;
    const idle = await cpuOver(procs.all, 15_000);
    const task1 = (await metrics()).TaskDuration;
    record(`${p}.idle.cpu`, idle, "%", "all Chromium processes, a note open, 15 s");
    record(`${p}.idle.main-thread`, ((task1 - task0) / 15) * 100, "%", "the page's main thread busy, 15 s");

    /* The search card: open it, type, wait for a match in the text. */
    t = now();
    let first = "timeout";
    try {
      await page.locator("[data-dag-open-boards]").first().click({ timeout: 10_000 });
      await page.locator("[data-dag-boards] input").fill("ledger");
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("[data-dag-hits] mark")].some((m) => m.textContent?.toLowerCase().startsWith("ledger")),
        null,
        { timeout: STEP_MS, polling: 50 },
      );
      first = now() - t;
    } catch {
      /* first stays timeout */
    }
    record(`${p}.search.first`, first, "ms", "card opened to the first match in the text (corpus fetched, index built)");
    if (first !== "timeout") {
      t = now();
      let next = "timeout";
      try {
        await page.locator("[data-dag-boards] input").fill("harbour");
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("[data-dag-hits] mark")].some((m) =>
              m.textContent?.toLowerCase().startsWith("harbour"),
            ),
          null,
          { timeout: STEP_MS, polling: 20 },
        );
        next = now() - t;
      } catch {
        /* next stays timeout */
      }
      record(`${p}.search.next`, next, "ms", "a second query on the built index");
      record(`${p}.heap.search`, mb((await metrics()).JSHeapUsedSize), "MB", "the page's JS heap with the search index");
      record(`${p}.rss.renderer.search`, mb(sumRss(chromiumProcs(b.pid).renderers)), "MB");
    }

    /* A request's cost from a page on `anydag serve`, to set beside the desktop's `anydag://`. */
    if (n === 1000) {
      const cost = await page.evaluate(async () => {
        const time = async (url, k) => {
          const t = performance.now();
          for (let i = 0; i < k; i++) await (await fetch(url)).arrayBuffer();
          return (performance.now() - t) / k;
        };
        await time("/api/health", 10);
        return { health: await time("/api/health", 200), list: await time("/__board/list", 20) };
      });
      record("page.request.health", cost.health, "ms", "browser → server, mean of 200");
      record("page.request.list", cost.list, "ms", "browser → server, /__board/list on 1k files, mean of 20");
      const direct = async (url, k) => {
        const t = now();
        for (let i = 0; i < k; i++) await s.req(url);
        return (now() - t) / k;
      };
      await direct("/api/health", 10);
      record("node.request.health", await direct("/api/health", 200), "ms", "Node fetch → server, mean of 200");
      record("node.request.list", await direct("/__board/list", 20), "ms", "Node fetch → server, mean of 20");
    }
    if (problems.length) record(`${p}.page-errors`, problems.length, "count", problems[0].slice(0, 80));
  } finally {
    await context.close();
  }
}

/** Boards, diagrams and notes of growing size, each to `data-dag-ready`. */
async function boardGroup(b) {
  const dir = path.join(work, "vault-boards");
  const home = path.join(work, "home-boards");
  const r = rng(7);
  makeVault(dir, 1, 7);
  fs.writeFileSync(path.join(dir, "Empty.board.md"), "---\ntitle: Empty\n---\n\n```md {#a x=0 y=0 w=320}\nHello.\n```\n");
  for (const n of BOARD_ITEMS) fs.writeFileSync(path.join(dir, `Board-${n}.board.md`), boardText(r, n, `Board ${n}`));
  for (const n of DIAGRAM_NODES)
    fs.writeFileSync(
      path.join(dir, `Arch-${n}.board.md`),
      `---\ntitle: Arch ${n}\n---\n\n\`\`\`arch {#arch x=0 y=0 title="${n} nodes"}\n${archBody(r, n)}\n\`\`\`\n`,
    );
  fs.writeFileSync(path.join(dir, "Note-1k.md"), noteText(r, 1_000, "title: Note 1k\n", []));
  fs.writeFileSync(path.join(dir, "Note-100k.md"), noteText(r, 100_000, "title: Note 100k\n", []));
  const s = await startServer(dir, home);
  const { context, page, metrics } = await pageOn(b, s);
  try {
    /* The first load pays for the page's own chunks; not a board's cost. */
    record("board.empty.first", await readyAfter(page, `${s.origin}/?board=Empty`), "ms", "first page load: chunks, fonts");
    const empty = [];
    for (let i = 0; i < 3; i++) empty.push(await readyAfter(page, `${s.origin}/?board=Empty`));
    record("board.empty.ready", median(empty), "ms", "one card: the floor every board below includes");
    const runs = async (metric, url, note) => {
      const xs = [];
      for (let i = 0; i < 3; i++) {
        const x = await readyAfter(page, url);
        xs.push(x);
        if (x === "timeout" || x > 60_000) break;
      }
      const nums = xs.filter((x) => typeof x === "number");
      if (nums.length === 0) return record(metric, "timeout", "ms", note);
      record(metric, median(nums), "ms", `${note}; median of ${nums.length}, max ${Math.round(Math.max(...nums))}`);
      return median(nums);
    };
    /* Idle with the board open: a fresh page, loaded once, measured 5 s after it said it was ready.
       Not the page the three loads above ran in: Chromium keeps one renderer for one site across
       navigations, and for a while after a reload of a big board its major GC is collecting the
       documents before — measured, 2-4% of a core for tens of seconds, which is not the board's. */
    const idleOn = async (prefix, url, what) => {
      const had = new Set(chromiumProcs(b.pid).renderers);
      const fresh = await pageOn(b, s);
      try {
        await readyAfter(fresh.page, url);
        await sleep(5_000);
        /* This page's renderer and the browser's own processes; not the renderer the reloads ran in. */
        const tree = chromiumProcs(b.pid);
        const renderers = tree.renderers.filter((p) => !had.has(p));
        const procs = { renderers, all: tree.all.filter((p) => !had.has(p)) };
        const task0 = (await fresh.metrics()).TaskDuration;
        const r0 = procs.renderers.map(cpuOf);
        const all = await cpuOver(procs.all, 10_000);
        const r1 = procs.renderers.map(cpuOf);
        const task1 = (await fresh.metrics()).TaskDuration;
        record(
          `${prefix}.idle.cpu`,
          all,
          "%",
          `Chromium (browser, GPU, this page's renderer), ${what} loaded once in a fresh page, 10 s`,
        );
        record(
          `${prefix}.idle.cpu.renderer`,
          r0.some((x) => x === null) ? null : (r1.reduce((a, x, i) => a + (x - r0[i]), 0) / 10) * 100,
          "%",
        );
        record(`${prefix}.idle.main-thread`, ((task1 - task0) / 10) * 100, "%", "the page's main thread busy");
        record(`${prefix}.rss.renderer.fresh`, mb(sumRss(procs.renderers)), "MB", "this page's renderer, loaded once");
      } finally {
        await fresh.context.close();
      }
    };
    for (const n of BOARD_ITEMS) {
      await runs(`board.${n}.ready`, `${s.origin}/?board=Board-${n}`, `${n} items, one in ten a diagram`);
      record(`board.${n}.heap`, mb((await metrics()).JSHeapUsedSize), "MB");
      record(`board.${n}.rss.renderer`, mb(sumRss(chromiumProcs(b.pid).renderers)), "MB");
      record(`board.${n}.dom.nodes`, await page.evaluate(() => document.getElementsByTagName("*").length), "count");
      if (n >= 100) await idleOn(`board.${n}`, `${s.origin}/?board=Board-${n}`, "the board");
    }

    for (const n of DIAGRAM_NODES)
      await runs(`diagram.${n}.ready`, `${s.origin}/?board=Arch-${n}`, `one arch diagram of ${n} nodes`);
    const biggest = DIAGRAM_NODES[DIAGRAM_NODES.length - 1];
    record(`diagram.${biggest}.heap`, mb((await metrics()).JSHeapUsedSize), "MB");
    record(`diagram.${biggest}.rss.renderer`, mb(sumRss(chromiumProcs(b.pid).renderers)), "MB");

    await runs("note.1k.ready", `${s.origin}/?note=Note-1k`, "a note of 1,000 words");
    await runs("note.100k.ready", `${s.origin}/?note=Note-100k`, "a note of 100,000 words");
    record("note.100k.heap", mb((await metrics()).JSHeapUsedSize), "MB");
    const d = await timedReq(s, "/__board/diagnostics?name=Arch-1000");
    if (DIAGRAM_NODES.includes(1000)) record("diagram.1000.parse", d.ms, "ms", "server: GET /__board/diagnostics");
  } finally {
    await context.close();
    await s.stop();
  }
}

/** Attachments: uploaded and read back, the server's peak memory after each. */
async function attachGroup() {
  const dir = path.join(work, "vault-attach");
  const home = path.join(work, "home-attach");
  const blobs = path.join(work, "blobs");
  fs.mkdirSync(blobs, { recursive: true });
  makeVault(dir, 1, 3);
  const s = await startServer(dir, home, { page: false });
  try {
    record("attach.server.rss.start", mb(memOf(s.pid).rss), "MB");
    for (const size of ATTACH_MB) {
      const file = path.join(blobs, `blob-${size}.bin`);
      const fd = fs.openSync(file, "w");
      for (let left = size * 1024 * 1024; left > 0; left -= 1 << 20) fs.writeSync(fd, randomBytes(Math.min(left, 1 << 20)));
      fs.closeSync(fd);
      const up = await timedReq(s, `/__board/file?folder=attachments&name=${encodeURIComponent(`blob-${size}.zip`)}`, {
        method: "POST",
        body: fs.createReadStream(file),
        duplex: "half",
        headers: { "content-length": String(size * 1024 * 1024), "content-type": "application/octet-stream" },
      });
      const kept = up.ms ? up.json().id : "";
      record(`attach.${size}.upload`, up.ms ?? (up.status ? `status ${up.status}` : "timeout"), up.ms ? "ms" : "");
      record(`attach.${size}.rss.peak.upload`, mb(memOf(s.pid).peak), "MB", "server peak RSS so far");
      const down = await timedReq(s, `/__board/file?id=${encodeURIComponent(kept)}`);
      record(`attach.${size}.read`, down.ms ?? "failed", "ms", "GET the whole file");
      const m = memOf(s.pid);
      record(`attach.${size}.rss.peak.read`, mb(m.peak), "MB", `server peak RSS so far; RSS now ${mb(m.rss)?.toFixed(0)} MB`);
      const ranged = await timedReq(s, `/__board/file?id=${encodeURIComponent(kept)}`, {
        headers: { range: "bytes=0-1023" },
      });
      record(`attach.${size}.range`, ranged.ms, "ms", "the first KB, as a PDF viewer asks");
      fs.rmSync(file);
    }
    /* Over the limit: refused by the declared length, before a byte of the body is sent. */
    const t = now();
    const over = await new Promise((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: s.port,
          method: "POST",
          path: "/__board/file?folder=attachments&name=over.zip",
          headers: { "x-anydag-token": s.token, "content-length": String(600 * 1024 * 1024) },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
          req.destroy();
        },
      );
      req.on("error", () => resolve("reset"));
      req.flushHeaders();
    });
    record("attach.over-limit.ms", now() - t, "ms", `answered ${over} to 600 MB declared, against the 512 MB default`);
    record("attach.vault.size", mb(duBytes(dir)), "MB");
  } finally {
    await s.stop();
  }
}

/** Does the server's memory keep growing under work that should not grow it? */
async function leakGroup() {
  const n = Math.min(10_000, Math.max(...SIZES));
  const dir = path.join(work, `vault-leak`);
  makeVault(dir, n, 11);
  const s = await startServer(dir, path.join(work, "home-leak"), { page: false });
  try {
    await s.req("/__board/list");
    await s.req("/__board/index");
    const rss = [];
    for (let round = 1; round <= 30; round++) {
      await s.req("/__board/list");
      await s.req("/__board/index");
      await s.req(`/__board/search?q=${WORDS[round % WORDS.length]}`);
      if (round % 10 === 0) rss.push(mb(memOf(s.pid).rss));
    }
    record(
      `leak.${n}.rounds.rss`,
      rss[rss.length - 1],
      "MB",
      `RSS after rounds 10/20/30: ${rss.map((x) => x?.toFixed(0)).join(" / ")}`,
    );
    const before = mb(memOf(s.pid).rss);
    for (let i = 0; i < 100; i++) {
      const f = await openFeed(s);
      f.close();
    }
    await sleep(2_000);
    const opened = await openFeed(s);
    /* Each feed a listener on the vault: if the dropped ones were kept, one write reaches them all. */
    fs.appendFileSync(path.join(dir, "inbox", "item-000000.md"), "\nleak check\n");
    await sleep(1_500);
    opened.close();
    record(`leak.feeds.rss`, mb(memOf(s.pid).rss), "MB", `100 feeds opened and dropped; before ${before?.toFixed(0)} MB`);
    record("leak.feeds.cpu-after", await cpuOver([s.pid], 5_000), "%", "server, after the feeds were dropped, 5 s");
  } finally {
    await s.stop();
  }
}

/** The Electron shell, on the 1k vault: memory per process, idle CPU, `anydag://` per request. */
/**
 * Launch the Electron shell on `dir` with a deep link to its `Bench` board, timed from the call:
 * to its first window, and to the board's `data-dag-ready`. A temp `HOME` and app home, so the shim
 * and Electron's own profile land in the temp folder.
 */
async function launchDesktop(dir, id, appHome) {
  const fakeHome = path.join(work, "desktop-user");
  fs.mkdirSync(fakeHome, { recursive: true });
  const env = { ...process.env, HOME: fakeHome, ANYDAG_HOME: appHome, ANYDAG_CLOUD: "off" };
  for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "ANYDAG_TOKEN", "ANYDAG_VAULT", "ELECTRON_RUN_AS_NODE"])
    delete env[k];
  const t0 = now();
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: [DESKTOP, dir, `anydag://open?vault=${id}&board=Bench`, ...(LINUX ? ["--no-sandbox"] : [])],
    env,
    timeout: 60_000,
  });
  const stop = async () => {
    live.delete(stop);
    await app.close().catch(() => undefined);
  };
  live.add(stop);
  let win = await app.firstWindow();
  const firstWindow = now() - t0;
  /* The deep link's window is the one with the board; the first may be the vault's own. */
  const deadline = now() + STEP_MS;
  let ready = null;
  while (now() < deadline && ready === null) {
    for (const w of app.windows()) {
      const r = await w.evaluate(() => document.documentElement.dataset.dagReady ?? null).catch(() => null);
      if (r === "1") {
        win = w;
        ready = now() - t0;
        break;
      }
    }
    if (ready === null) await sleep(50);
  }
  const inPage = ready === null ? null : await win.evaluate(() => performance.now()).catch(() => null);
  return { app, stop, win, firstWindow, ready: ready ?? "timeout", inPage };
}

/** Startup at each vault size: a first launch on a fresh app home, then a second on the same one. */
async function desktopStartup() {
  for (const n of SIZES) {
    const dir = path.join(work, `vault-startup-${n}`);
    const v = makeVault(dir, n, 13);
    fs.writeFileSync(path.join(dir, "Bench.board.md"), boardText(rng(13), 20, "Bench"));
    const appHome = path.join(work, `startup-home-${n}`);
    for (const run of ["cold", "warm"]) {
      const d = await launchDesktop(dir, v.id, appHome);
      try {
        const note = run === "cold" ? "first launch, fresh app home" : "second launch, same app home";
        record(`desktop.startup.${n}.${run}.first-window`, d.firstWindow, "ms", note);
        record(`desktop.startup.${n}.${run}.ready`, d.ready, "ms", `launch to a 20-item board drawn, ${n}-file vault`);
      } finally {
        await d.stop();
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function desktopGroup() {
  if (!fs.existsSync(DESKTOP)) {
    record("desktop", "skipped", "", "no desktop/dist/main.cjs — run `node desktop/build.mjs`");
    return;
  }
  if (LINUX && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    record("desktop", "skipped", "", "no display");
    return;
  }
  const dir = path.join(work, "vault-desktop");
  const v = makeVault(dir, 1000, 5);
  fs.writeFileSync(path.join(dir, "Bench.board.md"), boardText(rng(5), 20, "Bench"));
  const appHome = path.join(work, "desktop-home");
  const { app, stop, win, firstWindow, ready, inPage } = await launchDesktop(dir, v.id, appHome);
  try {
    record("desktop.first-window", firstWindow, "ms", "launch to the first window");
    record("desktop.ready", ready, "ms", "launch to data-dag-ready on a board of 20 items, 1k-file vault");
    record("desktop.ready.in-page", inPage, "ms", "the board's window: its navigation to data-dag-ready (±50 ms)");
    const mainPid = app.process().pid;
    const server = treeOf(mainPid).find((p) => p.cmd.includes("anydag-server.mjs"));
    await sleep(3_000);
    const metrics = async () => app.evaluate(({ app: a }) => a.getAppMetrics());
    const before = await metrics();
    const byType = {};
    for (const m of before) {
      byType[m.type] = (byType[m.type] ?? 0) + m.memory.workingSetSize * 1024;
    }
    for (const [type, bytes] of Object.entries(byType))
      record(`desktop.rss.${type.toLowerCase()}`, mb(bytes), "MB", "app.getAppMetrics() working set");
    if (server) record("desktop.rss.server", mb(memOf(server.pid).rss), "MB", "the server child (/proc)");
    const pids = before.map((m) => m.pid).concat(server ? [server.pid] : []);
    const total = (byType ? Object.values(byType).reduce((a, x) => a + x, 0) : 0) + (server ? (memOf(server.pid).rss ?? 0) : 0);
    record("desktop.rss.total", mb(total), "MB", "every process the app runs");
    const perProc = pids.map(cpuOf);
    await sleep(15_000);
    const after = pids.map(cpuOf);
    const types = before.map((m) => m.type).concat(server ? ["Server"] : []);
    const idle = {};
    pids.forEach((_, i) => {
      if (perProc[i] === null || after[i] === null) return;
      idle[types[i]] = (idle[types[i]] ?? 0) + ((after[i] - perProc[i]) / 15) * 100;
    });
    for (const [type, pct] of Object.entries(idle))
      record(`desktop.idle.cpu.${type.toLowerCase()}`, pct, "%", "15 s, the board open");
    const wakes = {};
    for (const m of await metrics()) wakes[m.type] = (wakes[m.type] ?? 0) + m.cpu.idleWakeupsPerSecond;
    for (const [type, n] of Object.entries(wakes))
      record(`desktop.idle.wakeups.${type.toLowerCase()}`, n, "/s", "app.getAppMetrics()");

    const cost = await win.evaluate(async () => {
      const time = async (url, k) => {
        const t = performance.now();
        for (let i = 0; i < k; i++) await (await fetch(url)).arrayBuffer();
        return (performance.now() - t) / k;
      };
      await time("/api/health", 10);
      return { health: await time("/api/health", 200), list: await time("/__board/list", 20) };
    });
    record("desktop.request.health", cost.health, "ms", "page → anydag:// → forward.ts → server, mean of 200");
    record("desktop.request.list", cost.list, "ms", "the same for /__board/list on 1k files, mean of 20");
    record("desktop.home.size", mb(duBytes(appHome)), "MB", "the app home after the launch");
  } finally {
    await stop();
  }
  await desktopStartup();
}

/* -- the guards ----------------------------------------------------------------------------------- */

async function guard(b) {
  const ceilings = JSON.parse(fs.readFileSync(path.join(root, "scripts", "bench-guard.json"), "utf8"));
  const dir = path.join(work, "vault-guard");
  makeVault(dir, 1000, 1);
  const r = rng(9);
  fs.writeFileSync(
    path.join(dir, "Arch-200.board.md"),
    `---\ntitle: Arch 200\n---\n\n\`\`\`arch {#arch x=0 y=0 title="200 nodes"}\n${archBody(r, 200)}\n\`\`\`\n`,
  );
  const s = await startServer(dir, path.join(work, "home-guard"));
  const over = [];
  try {
    await s.req("/__board/list");
    await s.req("/__board/index");
    const feed = await openFeed(s);
    await sleep(3_000);
    const idle = await cpuOver([s.pid], 20_000);
    feed.close();
    record("guard.idle-cpu", idle, "%", `server, 1k-file vault, change feed open, 20 s; ceiling ${ceilings.idleCpuPercent}`);
    if (idle !== null && idle > ceilings.idleCpuPercent) over.push("guard.idle-cpu");

    const { context, page } = await pageOn(b, s);
    try {
      await readyAfter(page, `${s.origin}/?board=Arch-200`);
      const xs = [];
      for (let i = 0; i < 3; i++) xs.push(await readyAfter(page, `${s.origin}/?board=Arch-200`, ceilings.layout200Ms * 3));
      const nums = xs.filter((x) => typeof x === "number");
      const ms = nums.length ? median(nums) : "timeout";
      record("guard.layout-200", ms, "ms", `arch, 200 nodes, to data-dag-ready, median of 3; ceiling ${ceilings.layout200Ms}`);
      if (ms === "timeout" || ms > ceilings.layout200Ms) over.push("guard.layout-200");
    } finally {
      await context.close();
    }
  } finally {
    await s.stop();
  }
  return over;
}

/* -- the run -------------------------------------------------------------------------------------- */

async function main() {
  const m = machine();
  const started = new Date().toISOString();
  console.log(`# AnyDag bench · ${started}`);
  console.log(`# ${m.cpu} · ${m.cores} cores · ${m.memoryGB} GB · ${m.os} · ${m.arch} · Node ${m.node}`);
  console.log(`# temp: ${work}  (${m.disk})`);
  const wantBrowser = GUARD || ONLY.has("page") || ONLY.has("board");
  const b = wantBrowser ? await launchBrowser() : null;
  if (b) console.log(`# Chromium ${b.browser.version()}`);
  let code = 0;
  try {
    if (GUARD) {
      const over = await guard(b);
      if (over.length) {
        console.error(`bench: over the ceiling: ${over.join(", ")} (scripts/bench-guard.json)`);
        code = 1;
      }
    } else {
      /* Boards first: the biggest vault leaves the shared browser holding gigabytes, and a board
         timed after it is timed on a machine still giving them back. */
      if (ONLY.has("board")) await boardGroup(b);
      if (ONLY.has("attach")) await attachGroup();
      if (ONLY.has("vault") || ONLY.has("page")) for (const n of SIZES) await vaultGroup(n, b);
      if (ONLY.has("leak")) await leakGroup();
      if (ONLY.has("desktop")) await desktopGroup();
    }
  } finally {
    if (b) await b.stop();
  }
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, `${JSON.stringify({ machine: m, started, args: argv, results }, null, 2)}\n`);
    console.log(`# wrote ${JSON_OUT}`);
  }
  return code;
}

main()
  .then((code) => shutdown(code))
  .catch(async (e) => {
    console.error(`bench: ${e?.stack ?? e}`);
    await shutdown(1);
  });
