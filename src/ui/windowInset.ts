import { desktop } from "@/vault/desktop";

/**
 * In the macOS desktop app the window has no title bar (`desktop/main.ts`, #78): its traffic
 * lights are drawn over the page's top-left corner. This puts `data-dag-window="inset"` on the
 * root while they are there, so `chrome.css` keeps that corner clear (`--window-inset`) and makes the
 * top row the window's drag region. Full screen hides the lights, so the attribute goes with them.
 *
 * Nothing in a browser, on Linux or Windows, or in `?snapshot=1`, which draws no chrome.
 */
export function watchWindowInset(): void {
  const shell = desktop();
  if (shell?.platform !== "darwin" || !shell.onFullScreen) return;
  if (new URLSearchParams(location.search).get("snapshot") === "1") return;
  const root = document.documentElement;
  const set = (full: boolean) => {
    if (full) delete root.dataset.dagWindow;
    else root.dataset.dagWindow = "inset";
  };
  set(shell.isFullScreen?.() ?? false);
  shell.onFullScreen(set);
}
