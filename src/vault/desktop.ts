/** The app's updates as the shell reports them (`desktop/updates.ts`, copied here because the page
 *  is built apart from the shell). */
export interface UpdateState {
  status: "idle" | "checking" | "downloading" | "ready" | "manual" | "error";
  /** `false` in a run with nothing packaged to replace. */
  enabled: boolean;
  /** The version running. */
  current: string;
  /** The newer version, from `downloading` to `manual`. */
  version: string | null;
  percent: number | null;
  /** When the last answered check finished, epoch milliseconds. */
  checkedAt: number | null;
  /** A sentence the person can act on, when `status` is `error`. */
  error: string | null;
}

/**
 * What the desktop shell (Electron) offers the page, and a browser does not. Every use is optional:
 * without it the page asks for a path in a field, and has no "reveal" button.
 */
export interface DesktopBridge {
  /** The key the shell asks of a write, so a document that is not the page cannot make one. */
  pageKey?: string | null;
  /** The `anydag` command the app wrote, by its absolute path, for an MCP client's config. */
  cli?: string | null;
  /** The system's folder dialog; `null` when it was cancelled. */
  pickFolder?(): Promise<string | null>;
  /** Show a folder in the file manager. */
  revealInFolder?(path: string): Promise<void> | void;
  /** A model provider's key, kept encrypted by the OS (`safeStorage`) and handed to the server as
   *  its environment. The page can store one and ask whether one is there; it never reads one back. */
  keys?: {
    set(name: string, value: string): Promise<boolean>;
    unset(name: string): Promise<boolean>;
    names(): Promise<string[]>;
  };
  /** The OpenAI-compatible address and model, which are not secrets and so may be read back. */
  providerEnv?: {
    get(): Promise<Record<string, string>>;
    set(name: string, value: string): Promise<boolean>;
  };
  /** The app's own updates: what is known, a check, and the restart. Absent in a browser. */
  updates?: {
    state(): Promise<UpdateState>;
    onChange(listener: (state: UpdateState) => void): () => void;
    check(): Promise<UpdateState>;
    install(): Promise<void>;
  };
  /** `process.platform` of the shell: `"darwin"` is the one whose window has no title bar. */
  platform?: string;
  /** Whether the window is in full screen now. */
  isFullScreen?(): boolean;
  /** Told when the window enters (`true`) or leaves (`false`) full screen; returns the unsubscribe. */
  onFullScreen?(listener: (full: boolean) => void): () => void;
}

declare global {
  interface Window {
    anydagDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => (typeof window === "undefined" ? undefined : window.anydagDesktop);
