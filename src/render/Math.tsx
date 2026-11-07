/**
 * An equation, drawn by KaTeX. What every surface draws one with: a
 * board's text card, a note read-only, an embedded note, the PDF, a quiz, and the note editor.
 *
 * Four things here are load-bearing:
 *
 * - **KaTeX is a chunk of its own** (`katex.ts`), asked for the first time a page draws an equation —
 *   the emoji's pattern. Until it lands an equation is its TeX, faint and in the mono, at roughly the
 *   size it will be.
 * - **A page is not ready until its equations are drawn** (`mathSettled`), because a picture over the
 *   TeX is a picture of a page that does not exist. Every place that raises `data-dag-ready` waits on
 *   it, and so does the PDF.
 * - **An equation that does not parse shows its TeX**, underlined in the theme's danger colour, with
 *   KaTeX's message as its title. Never a thrown error, and never KaTeX's own red: `throwOnError` is
 *   on so the error is ours to draw.
 * - **`strict: "ignore"`.** KaTeX's default warns on the console about LaTeX it accepts but would not
 *   itself write — a Unicode letter in math mode, say — and the e2e suite fails on any console output.
 *
 * `dangerouslySetInnerHTML` is KaTeX's own output, with `trust: false`: no `\href`, no `\htmlClass`,
 * no raw HTML. That is the one place in a Markdown renderer that sets HTML, and it is KaTeX's escaping
 * rather than anything of ours that keeps it safe.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import type Katex from "katex";

type KatexModule = typeof Katex;

let katex: KatexModule | null = null;
let loading: Promise<KatexModule> | null = null;
const listeners = new Set<() => void>();

/** Ask for KaTeX, once; every caller after the first is handed the same promise. */
export function loadKatex(): Promise<KatexModule> {
  loading ??= import("./katex").then((m) => {
    katex = m.default;
    for (const l of listeners) l();
    return katex;
  });
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const current = () => katex;

/**
 * KaTeX once it has landed, `null` until then — and the ask, if it has not. The ask is made while
 * rendering rather than in an effect: it is idempotent, and `mathSettled` must see it before the page
 * says it is ready. Under React 19 the note editor's equations are node views BlockNote commits after
 * the page's own effects have run, so an ask left to an effect came after the page had already
 * decided there was nothing to wait for.
 */
function useKatex(): KatexModule | null {
  const k = useSyncExternalStore(subscribe, current, current);
  if (!k) void loadKatex();
  return k;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Resolves once every equation the page has asked for is drawn: KaTeX loaded, what it drew laid out,
 * and the faces that layout asked for fetched. At once when nothing on the page is an equation.
 *
 * Two frames because the components draw KaTeX's HTML in the render after it lands, and the browser
 * only asks for a face once it lays out text set in it — `document.fonts.ready` asked any earlier
 * answers for the fonts already in hand.
 */
export async function mathSettled(): Promise<void> {
  /* A frame first: what the page is drawing may not have rendered an equation yet (the editor's
     node views come after the page's own effects), and "nothing asked" is only true once it has. */
  if (!loading) await frame();
  if (!loading) return;
  await loading;
  await frame();
  await frame();
  await document.fonts.ready;
}

type Drawn = { html: string } | { error: string };

/** What KaTeX made of one TeX, by mode. The editor and a board redraw the same equations often. */
const drawn = new Map<string, Drawn>();
const DRAWN_MAX = 2000;

function draw(k: KatexModule, tex: string, display: boolean): Drawn {
  const key = `${display ? "D" : "I"}${tex}`;
  let got = drawn.get(key);
  if (got) return got;
  try {
    got = {
      html: k.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml",
      }),
    };
  } catch (e) {
    got = { error: e instanceof Error ? e.message : String(e) };
  }
  if (drawn.size >= DRAWN_MAX) drawn.clear();
  drawn.set(key, got);
  return got;
}

/** Whether the TeX parses, and KaTeX's words if it does not — what the editor's field says under itself. */
export function mathError(tex: string): string | null | undefined {
  if (!katex) return undefined;
  const got = draw(katex, tex, true);
  return "error" in got ? got.error : null;
}

/**
 * One equation. `display` centres it on a line of its own, at display size; `block` draws it as a
 * `<div>` — an equation on lines of its own — and otherwise it is spans all the way down, so one in
 * the middle of a paragraph is still a paragraph's content.
 */
export function MathTex({ tex, display = false, block = false }: { tex: string; display?: boolean; block?: boolean }): ReactNode {
  const k = useKatex();
  const Tag = block ? "div" : "span";
  const shape = `dag-math ${display || block ? "dag-math--display" : "dag-math--inline"}${block ? " dag-math--block" : ""}`;
  if (!tex.trim()) return <Tag className={`${shape} dag-math--empty`} data-dag-math="empty" />;
  if (!k)
    return (
      <Tag className={`${shape} dag-math--pending`} data-dag-math="pending">
        {tex}
      </Tag>
    );
  const got = draw(k, tex, display || block);
  if ("error" in got)
    return (
      <Tag className={`${shape} dag-math--error`} data-dag-math="error" title={got.error}>
        {tex}
      </Tag>
    );
  return <Tag className={shape} data-dag-math="" dangerouslySetInnerHTML={{ __html: got.html }} />;
}
