import { useEffect, type RefObject } from "react";

import { drawnSettled } from "@/render/settled";
import { readIndex } from "@/refs/useIndex";

/**
 * When Markdown drawn read-only is *finished* — the bar `data-dag-ready` holds a board to: the fonts,
 * every embed, every equation and every picture. A note's PDF waits on it, and so do
 * a quiz's sheet and run, because a quiz can hold a board now and a picture of a quiz taken
 * before its board is drawn is a picture of an empty frame.
 *
 * It gives up after `READY_WITHIN` and says so anyway, because a picture that never comes is worse
 * than one with a gap where a broken embed was.
 */
export const READY_WITHIN = 20_000;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Until `test` holds, asked once a frame. */
async function until(test: () => boolean): Promise<void> {
  while (!test()) await frame();
}

/**
 * Everything inside `el` drawn. `index` is whether to wait for the references index first, which is
 * what turns an embed from a card into the drawing it names. A caller that draws from text already in
 * hand, with no index to ask, passes `false`.
 */
export async function drawn(el: HTMLElement, { index = true }: { index?: boolean } = {}): Promise<void> {
  await document.fonts.ready;
  /* An embed is drawn as the board or note it names only once the index says what that id is; before
     it, it is a card with nothing to wait on. On the editor's page the index is up long before anybody
     presses Export, and under `?snapshot=1` — `anydag note export` — it is not, which is how the first
     PDF from a terminal came out with a board's name where its drawing should have been. Two frames
     for React to draw what the answer changed. */
  if (index) await readIndex();
  await frame();
  await frame();
  /* An embed says when it is finished (`Ref.tsx`); one inside another note is a card, which never waits. */
  await until(() => Array.from(el.querySelectorAll("[data-dag-embed-kind]")).every((e) => e.hasAttribute("data-dag-embed-ready")));
  /* Equations, its own and its embeds': KaTeX loaded, what it drew laid out, its faces in. */
  await drawnSettled();
  /* Images last, since an embed's own come with it. `complete` covers a broken one too: it has finished. */
  await Promise.all(
    Array.from(el.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((r) => {
            img.addEventListener("load", () => r(), { once: true });
            img.addEventListener("error", () => r(), { once: true });
          }),
    ),
  );
  /* And two frames, so an embed's viewport has painted the fit its readiness set off. */
  await frame();
  await frame();
}

/**
 * `data-dag-ready` on the document once what `root` holds is drawn, for as long as `key` stands —
 * what a snapshot of a quiz waits on. Off again when `key` changes, or it unmounts.
 */
export function usePublishDrawn(root: RefObject<HTMLElement | null>, key: unknown, { index = true, enabled = true }: { index?: boolean; enabled?: boolean } = {}): void {
  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    let live = true;
    const gaveUp = new Promise<void>((r) => setTimeout(r, READY_WITHIN));
    void Promise.race([drawn(el, { index }), gaveUp]).then(() => {
      if (live) document.documentElement.dataset.dagReady = "1";
    });
    return () => {
      live = false;
      delete document.documentElement.dataset.dagReady;
    };
  }, [root, key, index, enabled]);
}
