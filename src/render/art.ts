import { useEffect, useSyncExternalStore } from "react";

/**
 * The art every glyph on a diagram is drawn from, fetched the first time something draws one.
 *
 * Four files, and none of them is a static import:
 *
 * - **`brand`** — `icons/data/icons.json`, the logos in their own colours and the silhouettes, 2.5 MB
 *   (0.8 MB gzipped). It was a static import "because every architecture diagram has a logo
 *   on it", and so a note, the calendar, the settings and a board of prose all carried it too.
 * - **`lucide`** — every Lucide glyph, `lucide-react` as one module. `icon=` can name any of about
 *   1,600, so the renderer looked them up in `import * as icons`, which no bundler can shake: all of
 *   them were in the first chunk every page loads — 4.1 MB of it, 1.2 MB gzipped, which is 0.9 MB
 *   and 0.3 MB without the two. The chrome's own glyphs are still named imports
 *   and stay where they were; this is only the drawing's.
 * - **`color`** and **`mono`** — the emoji's two cuts, the Flat cut in its own colours and
 *   the High Contrast cut in `currentColor`, each about a megabyte gzipped.
 *
 * Every pack is still all there — the library, the icon picker and the drawing reach every name
 * they did. What moved is *when* it is fetched. Which names exist is `./icon-index.ts`, so
 * `iconFor()` still decides what a name draws before any of this has arrived.
 *
 * **What draws before the file lands is a blank of the right size, never a fallback glyph.** A box
 * for a quarter of a second and then a logo is a flicker; a blank that fills is a picture loading.
 * And nothing measures it: a tile's box is the layout's, so the art arriving late moves nothing.
 *
 * **A diagram is not ready until its art is.** `DiagramItem` asks `useArtReady` for every file its
 * model draws from and holds its size report until they have landed, so `data-dag-ready` — which
 * the snapshot script and every Playwright check wait on — never fires over a board of blank tiles.
 * That is why this is a store with a subscription rather than a promise each `Icon` awaits alone.
 */

/** Which of the emoji's two cuts: the colour art, or the silhouette that takes the hue. */
export type EmojiCut = "color" | "mono";
/** Which file a glyph is drawn from. */
export type ArtCut = EmojiCut | "brand" | "lucide";

interface EmojiFile {
  width: number;
  height: number;
  icons: Record<string, { body: string; hFlip?: boolean } | undefined>;
}

export interface Glyph {
  body: string;
  width: number;
  height: number;
  hFlip?: boolean;
}

interface BrandFile {
  mono: Record<string, Glyph | undefined>;
  color: Record<string, Glyph | undefined>;
}

/** A Lucide glyph as `lucide-react` exports it. */
export type LucideGlyph = (props: {
  size?: number;
  strokeWidth?: number;
  strokeLinecap?: "round";
  strokeLinejoin?: "round";
  "aria-hidden"?: boolean;
}) => JSX.Element;

interface Files {
  color: EmojiFile | null;
  mono: EmojiFile | null;
  brand: BrandFile | null;
  lucide: Record<string, LucideGlyph | undefined> | null;
}

const files: Files = { color: null, mono: null, brand: null, lucide: null };
const pending: Partial<Record<ArtCut, Promise<void>>> = {};
const listeners = new Set<() => void>();
/* Bumped on every landing, so a snapshot that is "which files are here" changes identity exactly
   when the answer does — `useSyncExternalStore` compares by `Object.is`. */
let version = 0;

/* One `import()` per file, each its own chunk. Written out rather than built from a name, so the
   bundler can see every one of them. */
const IMPORTS: Record<ArtCut, () => Promise<unknown>> = {
  color: () => import("../../icons/data/emoji-color.json"),
  mono: () => import("../../icons/data/emoji-mono.json"),
  brand: () => import("../../icons/data/icons.json"),
  lucide: () => import("lucide-react"),
};

const load = (cut: ArtCut): Promise<void> =>
  (pending[cut] ??= IMPORTS[cut]()
    .then((m) => {
      /* A JSON chunk is its `default`; Lucide is the module namespace itself. */
      (files as unknown as Record<ArtCut, unknown>)[cut] = cut === "lucide" ? m : (m as { default: unknown }).default;
      version++;
      for (const l of listeners) l();
    })
    /* A chunk that fails to load leaves the tile blank and says nothing — the same thing a broken
       image does. Retrying on the next ask is the one useful response, so the promise is dropped
       rather than kept as a permanent failure. */
    .catch(() => {
      delete pending[cut];
    }));

/** The emoji cut an `icon=` value asks for, if it asks for an emoji at all. */
export function cutOf(icon: string | undefined): EmojiCut | null {
  if (!icon) return null;
  if (icon.startsWith("mono:emoji:")) return "mono";
  if (icon.startsWith("emoji:")) return "color";
  return null;
}

/** The art for `emoji:<name>`, `null` when that cut has no such picture, `undefined` until it has loaded. */
export function emojiGlyph(cut: EmojiCut, name: string): Glyph | null | undefined {
  const file = files[cut];
  if (!file) return undefined;
  const icon = file.icons[name.replace(/^(?:mono:)?emoji:/, "")];
  return icon ? { ...icon, width: file.width, height: file.height } : null;
}

/** A logo (`brand`) or a silhouette (`mono`) by its bundle name; `undefined` until the bundle has loaded. */
export function brandGlyph(mode: "brand" | "mono", name: string): Glyph | null | undefined {
  const file = files.brand;
  if (!file) return undefined;
  return (mode === "brand" ? file.color : file.mono)[name] ?? null;
}

/** A Lucide glyph by its export name; `undefined` until Lucide has loaded. */
export function lucideGlyph(name: string): LucideGlyph | null | undefined {
  const file = files.lucide;
  if (!file) return undefined;
  return file[name] ?? null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => version;

/**
 * Whether every file asked for has landed — and the ask, if one has not.
 *
 * An empty list is ready by definition, which is what keeps a diagram that draws no glyph at all
 * from waiting for anything.
 */
export function useArtReady(cuts: readonly ArtCut[]): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = [...new Set(cuts)].sort().join(",");
  useEffect(() => {
    for (const cut of key ? (key.split(",") as ArtCut[]) : []) void load(cut);
  }, [key]);
  return cuts.every((c) => files[c] !== null);
}
