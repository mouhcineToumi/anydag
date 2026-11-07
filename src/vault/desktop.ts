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
}

declare global {
  interface Window {
    anydagDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => (typeof window === "undefined" ? undefined : window.anydagDesktop);
