/**
 * The bridge between the page and the shell. Everything beyond this — the file dialog,
 * `shell`, `safeStorage` — is the main process's alone; the renderer can only call what is exposed
 * here, over the calls below.
 *
 * `keys` is write-only from the page's point of view: `isSet` says whether a name has a value,
 * never what the value is. Storing one is `set`, taking one away is `unset`; the main process
 * hands decrypted values to the server as env vars when it spawns it, so what the page knows about
 * its own key is *that* it exists, not what it is.
 */

import { contextBridge, ipcRenderer } from "electron";

import type { UpdateState } from "./updates";

declare const __ANYDAG_VERSION__: string;
const VERSION: string = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

export interface AnyDagDesktopKeys {
  /** Store or replace the value a provider is read by its env var name. */
  set(name: string, value: string): Promise<boolean>;
  /** Whether a value is stored, by name. The value never comes back. */
  isSet(name: string): Promise<boolean>;
  /** Take a stored value away. */
  unset(name: string): Promise<boolean>;
  /** The names with values. Names only, never values. */
  names(): Promise<string[]>;
}

/** What a provider needs besides its key and is not secret: the OpenAI-compatible address and
 *  model. Unlike a key, the page may read these back. Setting one restarts the server. */
export interface AnyDagDesktopProviderEnv {
  get(): Promise<Record<string, string>>;
  /** Store a value, or `""` to remove it. `false` for a name the shell does not keep or an address that is not http(s). */
  set(name: string, value: string): Promise<boolean>;
}

/** The app's own updates (`desktop/updates.ts`). The page draws the state and asks; the shell checks,
 *  downloads and installs. */
export interface AnyDagDesktopUpdates {
  /** What is known now. */
  state(): Promise<UpdateState>;
  /** Called with every change of state. Returns the unsubscribe. */
  onChange(listener: (state: UpdateState) => void): () => void;
  /** Ask whether a newer version exists; resolves with the answer's state. A no-op while a check, a
   *  download or a waiting update is already there. */
  check(): Promise<UpdateState>;
  /** The Update button: restart into the new version (the server is stopped first), or, on a build
   *  that cannot install it, open the release page. The page writes what it holds before calling. */
  install(): Promise<void>;
}

export interface AnyDagDesktop {
  /** What the page puts on a write so the shell knows the page sent it (`desktop/main.ts`,
   *  `trusted`). Absent in a subframe and on any document that is not the page. */
  readonly pageKey: string | null;
  /** The `anydag` command the app wrote, by its absolute path; `null` when it wrote none. */
  readonly cli: string | null;
  pickFolder(): Promise<string | null>;
  revealInFolder(target: string): Promise<void>;
  keys: AnyDagDesktopKeys;
  providerEnv: AnyDagDesktopProviderEnv;
  updates: AnyDagDesktopUpdates;
  readonly version: string;
  readonly platform: string;
  /** Whether the window is in full screen now. */
  isFullScreen(): boolean;
  /** Called with `true` when the window enters full screen, `false` when it leaves. Returns the unsubscribe. */
  onFullScreen(listener: (full: boolean) => void): () => void;
}

/* Asked once, synchronously, before any page script runs; the main process decides whether this
   frame is the page. */
const pageKey: string | null = ipcRenderer.sendSync("page:key") ?? null;

const cli: string | null = ipcRenderer.sendSync("cli:path") ?? null;

const api: AnyDagDesktop = {
  pageKey,
  cli,
  pickFolder(): Promise<string | null> {
    return ipcRenderer.invoke("folders:pick");
  },
  revealInFolder(target: string): Promise<void> {
    return ipcRenderer.invoke("folders:reveal", target);
  },
  providerEnv: {
    get(): Promise<Record<string, string>> {
      return ipcRenderer.invoke("providerEnv:get");
    },
    set(name: string, value: string): Promise<boolean> {
      return ipcRenderer.invoke("providerEnv:set", name, value);
    },
  },
  updates: {
    state(): Promise<UpdateState> {
      return ipcRenderer.invoke("update:state");
    },
    onChange(listener: (state: UpdateState) => void): () => void {
      const on = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on("update:state", on);
      return () => ipcRenderer.removeListener("update:state", on);
    },
    check(): Promise<UpdateState> {
      return ipcRenderer.invoke("update:check");
    },
    install(): Promise<void> {
      return ipcRenderer.invoke("update:install");
    },
  },
  keys: {
    set(name: string, value: string): Promise<boolean> {
      return ipcRenderer.invoke("keys:set", name, value);
    },
    isSet(name: string): Promise<boolean> {
      return ipcRenderer.invoke("keys:get", name);
    },
    unset(name: string): Promise<boolean> {
      return ipcRenderer.invoke("keys:delete", name);
    },
    names(): Promise<string[]> {
      return ipcRenderer.invoke("keys:names");
    },
  },
  get version(): string {
    return VERSION;
  },
  get platform(): string {
    return process.platform;
  },
  isFullScreen(): boolean {
    return ipcRenderer.sendSync("window:full-screen?") === true;
  },
  onFullScreen(listener: (full: boolean) => void): () => void {
    const on = (_event: Electron.IpcRendererEvent, full: unknown) => listener(full === true);
    ipcRenderer.on("window:full-screen", on);
    return () => ipcRenderer.removeListener("window:full-screen", on);
  },
};

contextBridge.exposeInMainWorld("anydagDesktop", api);
