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

export interface AnyDagDesktop {
  /** What the page puts on a write so the shell knows the page sent it (`desktop/main.ts`,
   *  `trusted`). Absent in a subframe and on any document that is not the page. */
  readonly pageKey: string | null;
  /** The `anydag` command the app wrote, by its absolute path; `null` when it wrote none. */
  readonly cli: string | null;
  pickFolder(): Promise<string | null>;
  revealInFolder(target: string): Promise<void>;
  keys: AnyDagDesktopKeys;
  readonly version: string;
  readonly platform: string;
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
};

contextBridge.exposeInMainWorld("anydagDesktop", api);
