/**
 * The Electron main process.
 *
 * One Node server, one runtime: the server is spawned with **Electron's own binary as Node**
 * (`ELECTRON_RUN_AS_NODE=1`), it answers loopback behind a per-launch token, and this process
 * serves the built page through `protocol.handle("anydag")`, adding the token as it forwards
 * `/__board/*` and `/api/*` to the server. The token never reaches page script, and a web page the
 * person has open cannot write into a vault either: the server refuses a host that is not loopback
 * (421) and a request that carries no token (401), and this process is what holds the token.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from "electron";
import { autoUpdater } from "electron-updater";

/* The one module the shell borrows from the server: where `~/.anydag/` is, so the keys, the
   `server.json` readback and the shim live where the server writes them. */
import { homeDir } from "../server/home";
import { forward } from "./forward";
import { serverHasStarted } from "./launch";
import { createUpdates, type Updates } from "./updates";

/* -- what the app ships, and where it finds it --------------------------------------------- */

const SCHEME = "anydag";
/** The host the page lives on: `anydag://app/…`. Deep links name other hosts (`open`). */
const APP_HOST = "app";

declare const __ANYDAG_VERSION__: string;
const VERSION: string = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

/** Whether this build was signed with a real identity (`ANYDAG_SIGNED=1` at `desktop/build.mjs`
 *  time, which the release workflow sets only when a certificate was there). An unsigned macOS app
 *  cannot update itself — Squirrel.Mac refuses an update whose signature does not match a designated
 *  requirement an ad-hoc signature does not have — so it does not download one to fail on. */
declare const __ANYDAG_SIGNED__: boolean;
const SIGNED: boolean = typeof __ANYDAG_SIGNED__ === "boolean" ? __ANYDAG_SIGNED__ : false;

/** The update channel is the version's own: `0.2.0` is `latest`, `0.2.0-beta.1` is `beta` and
 *  `0.2.0-nightly.202611070230` is `nightly`. The update files are named after it (`nightly.yml`,
 *  `nightly-linux.yml`, `nightly-mac.yml`; `desktop/package.mjs` hands electron-builder the word
 *  as `publish.channel`) and electron-updater reads the same word
 *  back off the running version, so a stable build only ever asks for the newest *stable* release
 *  (GitHub's "latest", which no pre-release is), a beta follows betas and what is stable, and a
 *  nightly follows nightlies. `allowPrerelease` is what lets the last two see a pre-release; it is
 *  set where the updater runs from the same word, rather than left to electron-updater's identical
 *  default, so the rule is readable there. `autoUpdater.channel` is deliberately never set: its
 *  setter turns on `allowDowngrade`, which a stable user must not get. */
const UPDATE_CHANNEL: string = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(VERSION)?.[1] ?? "latest";

/** Where the built page (`dist/`) is. `__dirname` is `desktop/dist` in dev and
 *  `<app.asar>/desktop/dist` packaged, so two levels up is the app's root in both — a real folder
 *  in dev, a path inside the asar packaged, and the main process reads its own asar. */
const PAGE_DIR = path.resolve(__dirname, "..", "..", "dist");

/** Where the bundles the *children* run live. Packaged they are unpacked from the asar: plain
 *  files, because an Electron-as-Node child cannot dlopen a native module out of an asar, and the
 *  server requires `@parcel/watcher`. */
const unpackedPath = (rel: string): string =>
  app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", rel) : path.resolve(__dirname, "..", "..", rel);
const serverBundle = (): string => unpackedPath(path.join("server", "dist", "anydag-server.mjs"));
const cliBundle = (): string => unpackedPath(path.join("cli", "dist", "anydag.mjs"));

/** The key env vars the server's providers read — `plugins/generate/providers.ts`. A key the
 *  person stored is decrypted here and handed to the server as its env var when it spawns. */
const PROVIDER_KEY_ENVS: readonly string[] = ["ANYDAG_LLM_API_KEY"];

/** What the OpenAI-compatible provider needs besides its key, and none of it is a secret: the
 *  address it speaks at and the model it serves. Kept beside the keys in `~/.anydag/`, in plain
 *  text, and handed to the server as its environment the same way — so the server reads it exactly
 *  as it reads `.env.local`, and the page may read it back to show it. */
const PROVIDER_ENV_NAMES: readonly string[] = ["ANYDAG_LLM_BASE_URL", "ANYDAG_LLM_MODEL"];

/** What the doc params of a deep link — `anydag://open?vault=<id>&…` — may name. The `view` and
 *  `snapshot` params of the page's own OPENS list are not documents a link opens. */
const DOC_PARAMS: readonly string[] = ["board", "note", "quiz", "table", "file", "tasks", "quizzes", "calendar", "ref"];

const SMOKE = process.env.ANYDAG_DESKTOP_SMOKE === "1";

const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

const say = (...parts: unknown[]): void => console.log(`anydag:`, ...parts);

/* -- one instance, one app ----------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) app.quit();

/* The scheme has to be registered privileged *before* ready: `standard` gives the page a real
   origin (its `localStorage`, its relative `fetch`), `secure` a secure context, `supportFetchAPI`
   the page's `fetch`, `stream` an SSE body that reaches `EventSource` as it is written, and
   `corsEnabled` the same-origin semantics `http://` has. */
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

process.on("exit", () => {
  /* A hard death — a crash, not only quit — must not leave a server behind. */
  try {
    child?.kill("SIGKILL");
  } catch {
    /* already gone */
  }
});

/* -- the server child ---------------------------------------------------------------------- */

let child: ChildProcess | null = null;
let serverPort = 0;
let serverToken = "";
let quitting = false;
let launchFolder: string | null = null;

/** Spawn `anydag-server.mjs` with Electron's own binary as Node — one runtime shipped, no Node of
 *  its own. `--no-page` because this process serves `dist/` itself; `--port 0` because the system
 *  picks, and the server says the number back on stdout and in its server.json — which is believed
 *  only for this child (`launch.ts`), never for a file an earlier server left behind. */
async function startServer(folder: string | null): Promise<void> {
  serverToken = randomBytes(32).toString("base64url");
  const args: string[] = [serverBundle()];
  if (folder) args.push(folder);
  args.push("--port", "0", "--no-page");
  /* The token goes in the environment, never on the command line: argv is readable by every user
     of the machine (`ps`), a process's environment only by its own user. */
  /* `ANYDAG_DESKTOP` makes the person's own Claude subscription the prompt card's default when
     Claude Code is installed and signed in (`defaultProvider` in plugins/generate/providers.ts). */
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", ANYDAG_TOKEN: serverToken, ANYDAG_DESKTOP: "1" };
  for (const name of PROVIDER_KEY_ENVS) {
    const said = decryptKey(name);
    if (typeof said === "string" && said !== "") env[name] = said;
  }
  for (const [name, value] of Object.entries(readProviderEnv())) env[name] = value;
  const secret = homeSecret();
  if (secret) env.ANYDAG_HOME_SECRET = secret;
  /* The IPC channel is how the server is asked to stop: Windows has no SIGTERM to send — `kill()`
     there is TerminateProcess, which leaves `server.json` behind and the index mid-write — and a
     channel that closes because this process died takes the server with it on every system. */
  child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => console.error(`anydag-server: ${chunk}`));
  child.on("error", (e) => {
    console.error(`anydag: could not spawn the server: ${e.message}`);
    if (!quitting && !SMOKE) dialog.showErrorBox("AnyDag", `The server could not start:\n${e.message}`);
    app.quit();
  });
  child.on("exit", (code, signal) => {
    if (quitting || !child) return;
    console.error(`anydag: the server went (${code ?? signal}) — leaving with it.`);
    child = null;
    app.quit();
  });
  const port = await serverHasStarted(child.stdout, { pid: child.pid, token: serverToken, home: homeDir() });
  if (!port) throw new Error("the server never said its port (20 s)");
  serverPort = port;
}

/**
 * A key the person stored reaches the server as its environment, which is read at spawn — so a
 * change restarts it. The vaults it had open are opened again (each keeps its id, which is in the
 * folder), the page's `EventSource` reconnects on its own, and the protocol handler reads the new
 * port and token the moment they exist.
 */
let restarting: Promise<void> | null = null;
function restartServer(): Promise<void> {
  restarting ??= (async () => {
    let open: string[] = [];
    try {
      const res = await net.fetch(`http://127.0.0.1:${serverPort}/api/vaults`, { headers: { "x-anydag-token": serverToken } });
      const listed = res.ok ? ((await res.json()) as { vaults: { path: string; open?: boolean }[] }) : null;
      open = (listed?.vaults ?? []).filter((v) => v.open).map((v) => v.path);
    } catch {
      /* not answering: start it on the launch folder alone */
    }
    await stopServer();
    await startServer(launchFolder);
    for (const folder of open) {
      if (folder === launchFolder) continue;
      await net
        .fetch(`http://127.0.0.1:${serverPort}/api/vaults/open`, {
          method: "POST",
          headers: { "x-anydag-token": serverToken, "content-type": "application/json" },
          body: JSON.stringify({ path: folder }),
        })
        .catch(() => undefined);
    }
  })().finally(() => {
    restarting = null;
  });
  return restarting;
}

async function stopServer(): Promise<void> {
  const said = child;
  child = null;
  if (!said) return;
  if (said.exitCode !== null || said.signalCode !== null) return;
  /* Closing the channel is the server's own `quit` (`server/main.ts`) on every system; SIGTERM is
     the same on the two that have one, for a server started before it listened to the channel. */
  if (said.connected) said.disconnect();
  if (process.platform !== "win32") said.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        said.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve();
    }, 2_000);
    said.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/* -- the keys, encrypted at rest ------------------------------------------------------------ */

interface StoredKey {
  /** `safeStorage` when an OS keyring was reached; `base64` for a machine with none. */
  scheme: "safeStorage" | "base64";
  value: string;
}
interface KeyFile {
  version: 1;
  keys: Record<string, StoredKey>;
}

const keyNameOk = (name: unknown): name is string => typeof name === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(name);

const keysFile = path.join(homeDir(), "keys.json");

function readKeys(): KeyFile {
  try {
    const it = JSON.parse(fs.readFileSync(keysFile, "utf8")) as KeyFile;
    if (it?.version === 1 && it.keys && typeof it.keys === "object") return it;
  } catch {
    /* no file yet */
  }
  return { version: 1, keys: {} };
}

function writeKeys(all: KeyFile): void {
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** A machine with no secret service (bare Hyprland, say) does not get a plain-text file silently:
 *  the value is encoded, the rest of the app works the same, and the console says which. */
function storeKey(name: string, value: string): void {
  const all = readKeys();
  if (value === "") {
    delete all.keys[name];
    writeKeys(all);
    return;
  }
  let entry: StoredKey;
  try {
    entry = { scheme: "safeStorage", value: safeStorage.encryptString(value).toString("base64") };
  } catch (e) {
    entry = { scheme: "base64", value: Buffer.from(value, "utf8").toString("base64") };
    console.error(`anydag: no OS keyring (${(e as Error).message}) — ${name} stored encoded, not encrypted`);
  }
  all.keys[name] = entry;
  writeKeys(all);
}

function decryptKey(name: string): string | null {
  const entry = readKeys().keys[name];
  if (!entry) return null;
  const bytes = Buffer.from(entry.value, "base64");
  if (entry.scheme === "base64") return bytes.toString("utf8");
  try {
    return safeStorage.decryptString(bytes);
  } catch (e) {
    console.error(`anydag: ${name} could not be decrypted: ${(e as Error).message}`);
    return null;
  }
}

/** The secret every vault key this install keeps for sync is sealed under (`server/sync/keys.ts`):
 *  32 random bytes, base64url, made on first launch and kept in `safeStorage` like a provider's key,
 *  never in a plain file. A `<home>/home.secret` the CLI made before the app ever ran is adopted, so
 *  what it linked still opens here. An entry that is there but will not decrypt — the keyring locked,
 *  or another user's — is never replaced: a new secret would orphan every vault key sealed under the
 *  old one. Nothing is passed then, and the server reads a `home.secret` that is there or refuses to
 *  sync (`SecretElsewhere` in `server/sync/keys.ts`), never making a second one. */
const HOME_SECRET = "ANYDAG_HOME_SECRET";

function homeSecret(): string | null {
  if (readKeys().keys[HOME_SECRET]) return decryptKey(HOME_SECRET);
  let secret: string;
  try {
    secret = fs.readFileSync(path.join(homeDir(), "home.secret"), "utf8").trim();
  } catch {
    secret = randomBytes(32).toString("base64url");
  }
  storeKey(HOME_SECRET, secret);
  return secret;
}

/* -- the provider settings that are not secrets ---------------------------------------------- */

const providerEnvFile = path.join(homeDir(), "provider-env.json");

function readProviderEnv(): Record<string, string> {
  try {
    const it = JSON.parse(fs.readFileSync(providerEnvFile, "utf8")) as unknown;
    if (!it || typeof it !== "object") return {};
    const out: Record<string, string> = {};
    for (const name of PROVIDER_ENV_NAMES) {
      const value = (it as Record<string, unknown>)[name];
      if (typeof value === "string" && value !== "") out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** An address is `http(s)://` and nothing else: it is where the server will send the key. */
const providerEnvOk = (name: string, value: string): boolean =>
  value.length <= 500 && (name !== "ANYDAG_LLM_BASE_URL" || value === "" || /^https?:\/\/[^\s]+$/i.test(value));

function storeProviderEnv(name: string, value: string): void {
  const all = readProviderEnv();
  if (value === "") delete all[name];
  else all[name] = value;
  fs.mkdirSync(path.dirname(providerEnvFile), { recursive: true });
  fs.writeFileSync(providerEnvFile, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** The page may only ever ask *whether* a key is there, by name. */
const isKeySet = (name: string): boolean => readKeys().keys[name] !== undefined;

/* -- windows -------------------------------------------------------------------------------- */

const windows = new Map<string, BrowserWindow>();

/** The page's address. A load always names a real path (`index.html`): `anydag://app/?x`'s empty
 *  path canonicalizes to `//`, a document whose `location.pathname` is `//` — and the page's own
 *  relative `history.replaceState` (`path + ?x`) then resolves to a scheme-only URL with no host,
 *  which the browser refuses as a different origin. A path makes every composition a plain one. */
const appUrl = (search: string): string =>
  search ? `${SCHEME}://app/index.html${search.startsWith("?") ? search : "?" + search}` : `${SCHEME}://app/index.html`;

/** `http(s)://` and `mailto:` belong to the browser and the mail client the person already has.
 *  Nothing else is handed to the OS: `file://`, `smb://` and a registered handler's scheme are each
 *  one click from running something, and a link in a note is text anybody could have written. */
const isExternal = (url: string): boolean => /^(https?:\/\/|mailto:)/i.test(url);

/* Every webContents the app creates — a window of a vault, a page's own popup window — gets the
   same two rules here, in one place: `window.open` against the app stays in a window of this app
   (created with the same isolation and sandbox through `overrideBrowserWindowOptions` on the
   `open` below), everything else outside is refused; navigation inside the page is never
   hijacked out to another shell by a link the person clicked. */
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const target = deepTargetOf(url);
    if (target) {
      openTarget(target);
      return { action: "deny" };
    }
    if (isExternal(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    /* An attachment or an asset is saved, never shown as a document of the app's origin. */
    if (isApiUrl(url)) {
      contents.downloadURL(url);
      return { action: "deny" };
    }
    /* A same-scheme target is the page's own popup — the `?view=1` page, say. */
    if (url.startsWith(`${SCHEME}://app/`)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: !app.isPackaged } };
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isApiUrl(url)) {
      event.preventDefault();
      contents.downloadURL(url);
      return;
    }
    if (url.startsWith(`${SCHEME}://app/`)) return;
    event.preventDefault();
    const target = deepTargetOf(url);
    if (target) {
      openTarget(target);
      return;
    }
    if (isExternal(url)) void shell.openExternal(url);
  });
  /* No webviews: the renderer embeds nothing but the page's own surfaces. */
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

function createWindow(vaultId: string, search: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 640,
    minHeight: 420,
    title: "AnyDag",
    show: false,
    backgroundColor: "#fbfbfa",
    /* On macOS the window has no title bar of its own (#78): the traffic lights sit in the page's top
       row, centred on its 48px, and the page's header and the sidebar's head are where the window is
       dragged from (`-webkit-app-region` in `chrome.css`). The page clears room for the lights while
       `data-dag-window="inset"` is on its root (`src/ui/windowInset.ts`), which full screen takes
       off — the lights are not drawn there. Linux and Windows keep the system's frame. */
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 17 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      /* The canvas publishes when the fonts land and a frame has painted; a throttled window
         never paints. A window somebody minimized is the one case this relaxes — fine. */
      backgroundThrottling: false,
    },
  });
  windows.set(vaultId, win);
  /* Full screen hides the traffic lights, so the room the page keeps for them goes too. */
  win.on("enter-full-screen", () => win.webContents.send("window:full-screen", true));
  win.on("leave-full-screen", () => win.webContents.send("window:full-screen", false));
  win.on("closed", () => {
    if (windows.get(vaultId) === win) windows.delete(vaultId);
  });
  win.once("ready-to-show", () => win.show());
  /* A window that never paints never fires `ready-to-show` — and a hidden window is throttled,
     so nothing paints. The page landing is the other place the window becomes visible. */
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible() && !win.isDestroyed()) win.show();
    win.focus();
  });
  void win.loadURL(appUrl(search));
  return win;
}

/* -- deep links ----------------------------------------------------------------------------- */

/**
 * A deep link is `anydag://open?vault=<id>&<doc param>…` — a window is *a vault*, so the `vault`
 * value names the window; the rest are the page's own query params, carried through untouched
 * (`board=`, `note=`, `quiz=`, `table=`, `file=`, …). `null` when the url is not a deep link, so a
 * navigation that is already the page goes by untouched.
 */
interface DeepTarget {
  vault: string | null;
  rest: URLSearchParams;
  /** The rest names a document: an existing window moves to it, not only forward. */
  doc: boolean;
}

function deepTargetOf(url: string): DeepTarget | null {
  if (!url.startsWith(`${SCHEME}://`)) return null;
  let what: URL;
  try {
    what = new URL(url);
  } catch {
    return null;
  }
  if (what.host === APP_HOST) return null;
  const rest = new URLSearchParams();
  let vault: string | null = null;
  what.searchParams.forEach((value, key) => {
    if (key === "vault") vault = value;
    else rest.append(key, value);
  });
  const doc = DOC_PARAMS.some((k) => rest.has(k));
  return { vault: vault != null && vault !== "" ? vault : null, rest, doc };
}

/** A target lands in the window of its vault — an existing one focused, and navigated when the
 *  link names a document — or a new window when none of that vault is open yet. */
function openTarget(target: DeepTarget): void {
  const vaultId = target.vault ?? "";
  const search = [target.vault !== null ? `vault=${encodeURIComponent(target.vault)}` : "", target.rest.toString()]
    .filter(Boolean)
    .join("&");
  const win = windows.get(vaultId);
  if (win && !win.isDestroyed()) {
    if (target.doc && search) void win.loadURL(appUrl(`?${search}`));
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  createWindow(vaultId, "?" + search);
}

/** A folder argument — a cold start or a second instance — becomes a vault of the running
 *  server, and then a window. The answer's `vault.id` is what `?vault=` says. */
async function openFolder(folder: string): Promise<void> {
  try {
    const res = await net.fetch(`http://127.0.0.1:${serverPort}/api/vaults/open`, {
      method: "POST",
      headers: { "x-anydag-token": serverToken, "content-type": "application/json" },
      body: JSON.stringify({ path: folder }),
    });
    if (!res.ok) {
      say(`could not open \`${folder}\` — ${res.status}`);
      return;
    }
    const said = (await res.json()) as { vault: { id: string } | null };
    if (!said.vault?.id) {
      createWindow("", "");
      return;
    }
    openTarget({ vault: said.vault.id, rest: new URLSearchParams(), doc: false });
  } catch (e) {
    say(`could not open \`${folder}\`: ${(e as Error).message}`);
  }
}

/** The argv a cold start or a `second-instance` hand over: one deep link, or a folder. */
function handleInvocation(argv: readonly string[]): void {
  const link = argv.find((a) => typeof a === "string" && a.startsWith(`${SCHEME}://`));
  if (link && serverPort > 0) {
    const target = deepTargetOf(link);
    if (target) openTarget(target);
    return;
  }
  const folder = folderArgOf(argv);
  if (folder && serverPort > 0) void openFolder(folder);
}

/** A folder exists-as-a-directory argument: everything else — `--flags`, links, junk — is not. */
function folderArgOf(argv: readonly string[]): string | null {
  const first = process.defaultApp /* dev: argv[0] electron, argv[1] main.cjs */ ? 2 : 1;
  for (let i = first; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith("-") || a.startsWith(`${SCHEME}://`)) continue;
    try {
      if (fs.statSync(a, { throwIfNoEntry: false })?.isDirectory()) return path.resolve(a);
    } catch {
      /* not it */
    }
  }
  return null;
}

/* -- the custom protocol -------------------------------------------------------------------- */

/** A path the page asks for that goes to the server, with the token attached here and nowhere else. */
const isApiPath = (pathname: string): boolean => pathname.startsWith("/__board/") || pathname.startsWith("/api/");
const isApiUrl = (url: string): boolean => {
  try {
    const at = new URL(url);
    return at.protocol === `${SCHEME}:` && at.host === APP_HOST && isApiPath(at.pathname);
  } catch {
    return false;
  }
};

function forwardHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  /* The server answers this path with the header only; no cookie is in the shell's exchange. */
  for (const name of ["host", "connection", "content-length", "cookie", "origin", PAGE_HEADER]) headers.delete(name);
  headers.set("x-anydag-token", serverToken);
  return headers;
}

/**
 * Only the page writes. Chromium hands a custom scheme's handler no `Origin` and runs no CORS
 * preflight for it, so neither where a request came from nor a fixed header can be asked. What can
 * is a secret only the page holds: `pageKey`, minted per launch and handed by the preload to the
 * **top frame of a window showing the page**, never to a subframe and never to a document served
 * from an api path. The page's `fetch` wrapper (`src/vault/current.ts`) puts it on every write. It
 * is not the server's token — that stays in this process — and what it guards is narrower: a
 * document that is not the page (an SVG attachment, say) reads at most, and never writes.
 */
const PAGE_HEADER = "x-anydag-page";
const pageKey = randomBytes(32).toString("base64url");
const READS = new Set(["GET", "HEAD"]);

function trusted(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return false;
  return READS.has(method) || request.headers.get(PAGE_HEADER) === pageKey;
}

async function handleProtocol(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (isApiPath(url.pathname) && !trusted(request)) return new Response("not from the page", { status: 403 });
  if (serverPort > 0 && isApiPath(url.pathname)) {
    try {
      /* Not `net.fetch`: Chromium's six connections to a host, and a stream the page closed that was
         never let go, are what blanked a note and froze the sidebar (#123) — see `forward.ts`. */
      const res = await forward(request, serverPort, forwardHeaders(request.headers));
      /* The token never rode back and no cookie is needed — the server's gate was answered here. */
      res.headers.delete("set-cookie");
      return res;
    } catch (e) {
      return new Response(`anydag: the server is not answering: ${(e as Error).message}`, { status: 502 });
    }
  }
  return serveStatic(url.pathname);
}

/** The built page, and nothing else: a file of `dist/`, `index.html` when the path is not one, each
 *  answer's cache rule the same rule `server/app.ts` gives the page it serves. */
function serveStatic(pathname: string): Response {
  const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".map": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".ico": "image/x-icon",
  };
  try {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
    let file = path.resolve(PAGE_DIR, rel);
    if (file !== PAGE_DIR && !file.startsWith(PAGE_DIR + path.sep)) return new Response("outside the page", { status: 403 });
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) file = path.join(PAGE_DIR, "index.html");
    const ext = path.extname(file).toLowerCase();
    const bytes = fs.readFileSync(file);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return new Response(`anydag: page not served: ${(e as Error).message}`, { status: 500 });
  }
}

/* -- the shim -------------------------------------------------------------------------------- */

/** `~/.local/bin/anydag`, or on Windows `anydag.cmd` in the app's home — `%APPDATA%` has no folder
 *  on the PATH to put it in, so the AI tab gives the absolute path instead (`cli:path`). */
const shimPath = (): string =>
  process.platform === "win32" ? path.join(homeDir(), "bin", "anydag.cmd") : path.join(os.homedir(), ".local", "bin", "anydag");

/** Where the shim was written this launch, for the page to print in an MCP config. */
let shimAt: string | null = null;

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** `~/.local/bin/anydag`, written once the app knows where its own CLI is, so the person's terminal
 *  finds the app that is running. Two shapes: from an
 *  AppImage the CLI sits inside a squashfs mounted fresh for each run, so the shim mounts the app
 *  itself (`--appimage-mount`, extracting into a scratch dir when mounting fails) and reaches the
 *  CLI through the asar there; anywhere else the CLI path is
 *  one durable file and the shim is one `exec`. */
function writeShim(): void {
  if (SMOKE) return;
  const file = shimPath();
  let ours = false;
  try {
    /* `# anydag shim` in the sh shim, `rem anydag shim` in the cmd one. */
    ours = fs.readFileSync(file, "utf8").includes("anydag shim —");
  } catch {
    /* absent */
  }
  if (fs.existsSync(file) && !ours) {
    say(`\`${file}\` is somebody else's already — not touching it.`);
    return;
  }
  /* A macOS app run from the disk image, or from a quarantined download that Gatekeeper moved to a
     random read-only path (App Translocation), is not where it will live: a shim written now would
     name a path that is gone next launch. The launch from /Applications writes it. */
  if (
    process.platform === "darwin" &&
    (process.execPath.startsWith("/Volumes/") || process.execPath.includes("/AppTranslocation/"))
  ) {
    say(`running from \`${path.dirname(process.execPath)}\` — move AnyDag to Applications for the \`anydag\` command.`);
    return;
  }
  if (process.platform === "win32") {
    /* `cmd` quoting: a path in double quotes, and `%*` for the arguments as they were typed. */
    const lines = [
      "@echo off",
      "rem anydag shim — written by the AnyDag app; safe to delete.",
      /* A `set` in a batch file outlives it in the shell that ran it; `setlocal` keeps it here. */
      "setlocal",
      "set ELECTRON_RUN_AS_NODE=1",
      `"${process.execPath}" "${cliBundle()}" %*`,
    ];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\r\n") + "\r\n");
    shimAt = file;
    say(`wrote ${file}`);
    return;
  }
  const appImage = app.isPackaged ? process.env.APPIMAGE : undefined;
  /** The CLI is inside the asar in every packaged shape, and the asar file survives the mount. */
  const cliMounted = "resources/app.asar/cli/dist/anydag.mjs";
  /** The build's own name for the electron binary in the squashfs — fixed by `electron-builder.yml`
     (`executableName`), because the same name has to be right in the shim and inside the mount. */
  const EXEC_NAME = "anydag";
  let lines: string[];
  if (appImage) {
    lines = [
      "#!/bin/sh",
      "# anydag shim — written by the AnyDag app; safe to delete.",
      `app=${shQuote(appImage)}`,
      "export ELECTRON_RUN_AS_NODE=1",
      'if [ ! -x "$app" ]; then',
      '  echo "anydag: the app has moved or been removed. Open the app once to update this command." >&2',
      "  exit 127",
      "fi",
      "unset APPIMAGE_EXTRACT_AND_RUN",
      "work=$(mktemp -d) || exit 1",
      '"$app" --appimage-mount >"$work/mount" 2>/dev/null &',
      "mounter=$!",
      'trap \'kill "$mounter" 2>/dev/null; rm -rf "$work"\' EXIT',
      "trap 'exit 130' INT TERM",
      "mount=",
      'while kill -0 "$mounter" 2>/dev/null; do',
      '  mount=$(head -n 1 "$work/mount")',
      '  [ -d "$mount" ] && break',
      "  mount=",
      "  sleep 0.05",
      "done",
      'if [ -z "$mount" ]; then',
      '  (cd "$work" && "$app" --appimage-extract >/dev/null 2>&1) || { echo "anydag: could not open $app." >&2; exit 1; }',
      '  mount="$work/squashfs-root"',
      "fi",
      /* The binary, not `AppRun`: the AppImageKit script reads `$APPDIR` from its environment, and
         an outer AppImage launch (this one, extract-and-run, badly named env peer) can leave a
         stale one behind. Electron-as-Node wants no AppRun's work beyond this file. */
      "unset APPDIR",
      `exec "$mount/${EXEC_NAME}" "$mount/${cliMounted}" "$@"`,
    ];
  } else {
    lines = [
      "#!/bin/sh",
      "# anydag shim — written by the AnyDag app; safe to delete.",
      `ELECTRON_RUN_AS_NODE=1 exec ${shQuote(process.execPath)} ${shQuote(cliBundle())} "$@"`,
    ];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o755 });
  shimAt = file;
  say(`wrote ${file}`);
}

/* -- the smoke check ------------------------------------------------------------------------ */

/**
 * `ANYDAG_DESKTOP_SMOKE=1` makes the app load the first board of the vault it was launched with,
 * wait for the page to publish `data-dag-ready`, say one line, and quit — what the verification
 * runs. It writes nothing outside its temp home: no shim, no protocol registration, no updater.
 */
async function runSmoke(win: BrowserWindow): Promise<void> {
  let board: string | null = null;
  if (launchFolder) {
    try {
      const files = fs
        .readdirSync(launchFolder)
        .filter((f) => f.toLowerCase().endsWith(".board.md"))
        .sort();
      if (files.length > 0) board = files[0].slice(0, -".board.md".length);
    } catch {
      /* the folder is not readable: the bare page */
    }
    if (board === null) say(`no board file in \`${launchFolder}\` — the bare page is what is waited on`);
  }
  const url = appUrl(board === null ? "" : `?board=${encodeURIComponent(board)}`);
  /* Generous: a cold x64 build under Rosetta spends most of a minute being translated. A healthy
     run leaves the moment the page says it is drawn. */
  const deadline = Date.now() + 90_000;
  let ready: string | null = null;
  try {
    await win.loadURL(url);
    while (Date.now() < deadline) {
      if (win.isDestroyed()) break;
      const seen = (await win.webContents.executeJavaScript(
        `(document.documentElement.dataset.dagReady ?? null) === null ? null : String(document.documentElement.dataset.dagReady)`,
        true,
      )) as unknown;
      if (typeof seen === "string") {
        ready = seen;
        break;
      }
      await wait(200);
    }
  } catch (e) {
    console.error(`smoke: ${url} failed: ${(e as Error).message}`);
  }
  console.log(`smoke: loaded ${url} ready=${ready ?? "never"}`);
  await stopServer();
  app.exit(ready === "1" ? 0 : 1);
}

/* -- the run -------------------------------------------------------------------------------- */

app.on("second-instance", (_event, argv) => {
  if (serverPort > 0) handleInvocation(argv);
});
/* macOS gives a deep link as an event, never an argv — and a cold one arrives before the server
   has said its port, so it is kept for `whenReady` rather than dropped. */
let coldLink: string | null = null;
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (serverPort > 0) handleInvocation([url]);
  else coldLink = url;
});

app.on("window-all-closed", () => {
  if (!SMOKE) void quit();
});

app.on("activate", () => {
  /* The dock icon is there again: the vault-less window comes back. */
  if (SMOKE) return;
  openTarget({ vault: null, rest: new URLSearchParams(), doc: false });
});

/** Quit: stop the server first, then let the process go. The server's own SIGTERM removes
 *  `server.json` on the disk the same way any Ctrl+C of `anydag serve` would. */
async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    await stopServer();
  } finally {
    app.exit(0);
  }
}

/** Whether an IPC call came from the top frame of a window showing the page — the only sender that
 *  may ask for the write key or restart the app into an update. */
function fromPage(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  const top = frame !== null && frame === event.sender.mainFrame;
  return top && frame.url.startsWith(`${SCHEME}://${APP_HOST}/`) && !isApiUrl(frame.url);
}

/** Where a release's files and notes are, for a build that cannot install the update itself. */
const releaseUrl = (version: string): string =>
  `https://github.com/mouhcineToumi/anydag/releases/tag/v${encodeURIComponent(version)}`;

/** Whether this build can put an update in place itself. An unsigned macOS build cannot (see
 *  `SIGNED`), and an AppImage replaces its own file, so it needs the folder it sits in to be
 *  writable — a root-owned `/opt` copy is not, and a download that cannot land is a download wasted. */
function canInstallUpdates(): boolean {
  if (process.platform === "darwin" && !SIGNED) return false;
  const appImage = process.env.APPIMAGE;
  if (appImage) {
    try {
      fs.accessSync(path.dirname(appImage), fs.constants.W_OK);
      fs.accessSync(appImage, fs.constants.W_OK);
    } catch {
      return false;
    }
  }
  return true;
}

/** The app's updates: what is known, asked for, and installed (`desktop/updates.ts`). */
let updates: Updates;

function makeUpdates(): void {
  autoUpdater.allowPrerelease = UPDATE_CHANNEL !== "latest";
  updates = createUpdates({
    updater: autoUpdater,
    enabled: app.isPackaged && !SMOKE,
    current: VERSION,
    canInstall: canInstallUpdates(),
    releaseUrl,
    openExternal: (url) => void shell.openExternal(url),
    /* The same order a normal quit has: say it is a quit (so the child's exit is not "the server
       went"), close the channel the server was spawned with, and wait for it to leave — only then
       may the installer run, because on Windows it starts at once and the server holds the vault. */
    prepareToQuit: async () => {
      quitting = true;
      await stopServer();
    },
    recoverFromQuit: async () => {
      quitting = false;
      await restartServer();
    },
    log: say,
  });
  updates.subscribe((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("update:state", state);
    }
  });
}

async function whenReady(): Promise<void> {
  app.setAppUserModelId("io.github.mouhcinetoumi.anydag");
  /* The page's write key, to the top frame of a window showing the page and to nothing else. */
  ipcMain.on("page:key", (event) => {
    event.returnValue = fromPage(event) ? pageKey : null;
  });
  /* The updates the page may ask about, and the one thing it may start: the page sends `install`
     only after it has written what it holds (`src/ui/pendingWrites.ts`). */
  ipcMain.handle("update:state", () => updates.state());
  ipcMain.handle("update:check", async (event) => {
    if (fromPage(event)) await updates.check();
    return updates.state();
  });
  ipcMain.handle("update:install", async (event) => {
    if (fromPage(event)) await updates.install();
  });
  /* Whether the page's window is in full screen as it loads; the change after is pushed. */
  ipcMain.on("window:full-screen?", (event) => {
    event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });
  /* Where the `anydag` command is, so the AI tab's MCP lines work without it on the PATH. */
  ipcMain.on("cli:path", (event) => {
    event.returnValue = shimAt;
  });
  ipcMain.handle("folders:pick", async (event: Electron.IpcMainInvokeEvent): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "Open a vault folder",
    };
    const out = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return out.canceled || out.filePaths.length === 0 ? null : out.filePaths[0];
  });
  ipcMain.handle("folders:reveal", (_event, target: unknown): void => {
    if (typeof target !== "string" || target === "") return;
    try {
      shell.showItemInFolder(target);
    } catch (e) {
      console.error(`anydag: could not reveal \`${target}\`: ${(e as Error).message}`);
    }
  });
  ipcMain.handle("keys:get", (_event, name: unknown): boolean => (keyNameOk(name) ? isKeySet(name) : false));
  ipcMain.handle("keys:set", async (_event, name: unknown, value: unknown): Promise<boolean> => {
    if (!keyNameOk(name) || !PROVIDER_KEY_ENVS.includes(name) || typeof value !== "string") return false;
    storeKey(name, value.trim());
    await restartServer();
    return true;
  });
  ipcMain.handle("keys:delete", async (_event, name: unknown): Promise<boolean> => {
    if (!keyNameOk(name) || !PROVIDER_KEY_ENVS.includes(name)) return false;
    storeKey(name, "");
    await restartServer();
    return true;
  });
  ipcMain.handle("providerEnv:get", (): Record<string, string> => readProviderEnv());
  ipcMain.handle("providerEnv:set", async (_event, name: unknown, value: unknown): Promise<boolean> => {
    if (typeof name !== "string" || !PROVIDER_ENV_NAMES.includes(name) || typeof value !== "string") return false;
    const said = value.trim();
    if (!providerEnvOk(name, said)) return false;
    if ((readProviderEnv()[name] ?? "") === said) return true;
    storeProviderEnv(name, said);
    await restartServer();
    return true;
  });
  ipcMain.handle("keys:names", (): string[] =>
    Object.keys(readKeys().keys)
      .filter((name) => PROVIDER_KEY_ENVS.includes(name))
      .sort(),
  );

  launchFolder = folderArgOf(process.argv);
  /* Ready first: the server's spawn reads the stored keys and the home secret through
     `safeStorage`, which throws before ready — and `storeKey` then fell back to writing the home
     secret merely encoded, on every first launch. Windows and the scheme's handler need it too. */
  await app.whenReady();
  await startServer(launchFolder);
  /* Before any window: the page asks for the state as it loads. */
  makeUpdates();

  protocol.handle(SCHEME, handleProtocol);

  if (!SMOKE) {
    /* A deep link has to be registered by something that outlives the process — the app bundle's
       Info.plist on macOS (the `protocols` key in electron-builder.yml), and on Windows the
       per-user registry key `setAsDefaultProtocolClient` writes, naming the installed exe (the NSIS
       installer registers no scheme of its own) — but only where the running path is durable. A
       dev run would write `node_modules` into the OS, and an AppImage runs out of a mounted
       squashfs that is gone the moment it stops; AppImageKit's own `appimaged` (or the .desktop it
       ships) is what owns the association there. */
    if (app.isPackaged && !process.env.APPIMAGE) app.setAsDefaultProtocolClient(SCHEME);
    /* The shim points at a durable place — the AppImage file (`$APPIMAGE` even in extract-and-run)
       or the installed binary — so a late run of the CLI fights no moving target. */
    writeShim();
  }

  /* A cold deep link beats the empty window; a folder argument has already gone to the server. */
  if (SMOKE) {
    const win = createWindow("", "");
    await runSmoke(win);
    return;
  }
  const link = coldLink ?? process.argv.find((a) => typeof a === "string" && a.startsWith(`${SCHEME}://`));
  const target = link ? deepTargetOf(link) : null;
  if (target) openTarget(target);
  else if (launchFolder) {
    const res = await net.fetch(`http://127.0.0.1:${serverPort}/api/vaults`, { headers: { "x-anydag-token": serverToken } });
    const listed = res.ok ? ((await res.json()) as { vaults: { id: string; path: string; default?: boolean }[] }) : null;
    const mine = listed?.vaults.find((v) => v.path === launchFolder) ?? listed?.vaults.find((v) => v.default) ?? null;
    openTarget({ vault: mine?.id ?? null, rest: new URLSearchParams(), doc: false });
  } else createWindow("", "");

  say(`${VERSION} ready — ${serverPort}`);

  /* After the window, so a check's first answer has somewhere to go. */
  if (updates.state().enabled) say(`updates: channel ${UPDATE_CHANNEL}${canInstallUpdates() ? "" : ", by hand"}`);
  updates.start();
}

void whenReady().catch((e) => {
  console.error(`anydag: ${(e as Error).message}`);
  if (SMOKE) {
    void stopServer().finally(() => app.exit(1));
    return;
  }
  dialog.showErrorBox("AnyDag", `The app could not start:\n${(e as Error).message}`);
  void stopServer().finally(() => app.exit(1));
});

/* A quit the OS asked for (SIGINT, the app menu, a session end) runs the same stop-the-server
   sequence as a last window closing; `app.exit` from here does not fire `before-quit` again. */
app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    void quit();
  }
});
