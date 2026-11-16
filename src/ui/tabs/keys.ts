import { useEffect, useRef } from "react";

import { desktop } from "@/vault/desktop";

/**
 * The document tabs' keys, as a browser's (#264).
 *
 * | Keys | Does |
 * |---|---|
 * | Ctrl/⌘+T | a new tab, on Home, in front |
 * | Ctrl/⌘+W | close the tab in front |
 * | Ctrl/⌘+Shift+T | open the last tab closed again, where it was |
 * | Ctrl+Tab · Ctrl+Shift+Tab, Ctrl+PageDown · Ctrl+PageUp | the next tab · the one before, round the ends |
 * | Ctrl/⌘+1 … 8 · 9 | the tab at that place · the last |
 *
 * **In the desktop app only.** A browser keeps every one of these for its own tabs and never lets
 * the page hear them, so in `anydag serve` they do what the browser does; the page listens anyway,
 * and has them wherever a browser does let them through. In the desktop app the window's own menu
 * holds Ctrl/⌘+W for closing the window, and it would win over the page — so the shell takes the
 * chord before the menu does and sends it here instead (`desktop/main.ts`, `tabs:close`).
 *
 * Ctrl+Tab is Ctrl on a Mac too, as in every browser there. Nothing else in the app binds these:
 * the editors' chords are Ctrl/⌘ with Alt or Shift and a digit, never a bare digit.
 */
export interface TabKeys {
  newTab(): void;
  closeTab(): void;
  reopen(): void;
  step(dir: 1 | -1): void;
  nth(n: number): void;
}

const isMac = (): boolean =>
  desktop()?.platform === "darwin" || (typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? ""));

/** What a key press asks of the tabs, if anything. Pure, for the tests. */
export function tabKey(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  mac: boolean,
): { do: "new" | "close" | "reopen" } | { do: "step"; dir: 1 | -1 } | { do: "nth"; n: number } | null {
  if (e.altKey) return null;
  if (e.ctrlKey && !e.metaKey) {
    if (e.key === "Tab") return { do: "step", dir: e.shiftKey ? -1 : 1 };
    if (!e.shiftKey && e.key === "PageDown") return { do: "step", dir: 1 };
    if (!e.shiftKey && e.key === "PageUp") return { do: "step", dir: -1 };
  }
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  /* The letter typed, as a browser reads it — Ctrl+Y on a Dvorak board is redo, though its key is
     where T is elsewhere. The key's place only when it typed no Latin letter (a Cyrillic layout). */
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === "KeyT" ? "t" : e.code === "KeyW" ? "w" : "";
  if (letter === "t") return { do: e.shiftKey ? "reopen" : "new" };
  if (letter === "w" && !e.shiftKey) return { do: "close" };
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
  if (digit && !e.shiftKey) return { do: "nth", n: Number(digit) };
  return null;
}

/** Listen for the tabs' keys while `on`, and for the desktop shell's close. */
export function useTabKeys(on: boolean, keys: TabKeys): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    if (!on) return;
    const mac = isMac();
    const onKey = (e: KeyboardEvent) => {
      const asked = tabKey(e, mac);
      if (!asked) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat && asked.do !== "step") return;
      const k = ref.current;
      switch (asked.do) {
        case "new":
          return k.newTab();
        case "close":
          return k.closeTab();
        case "reopen":
          return k.reopen();
        case "step":
          return k.step(asked.dir);
        case "nth":
          return k.nth(asked.n);
      }
    };
    /* In the capture phase, ahead of a board's or a note's own keys: these are the window's. */
    addEventListener("keydown", onKey, true);
    const off = desktop()?.tabs?.onClose(() => ref.current.closeTab());
    return () => {
      removeEventListener("keydown", onKey, true);
      off?.();
    };
  }, [on]);
}
