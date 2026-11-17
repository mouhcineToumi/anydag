// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NoteMarkdown, type MarkdownImg } from "@/view/NoteRead";

/**
 * A note handed to a caller that draws its references: `![[Target]]` is an embed, and an embed is
 * the caller's — a wikilink's URL is `wiki:…`, exactly as a `dag:` reference's is `dag:…`.
 *
 * The wrapper that gives a note its own pictures (`NoteRead`) used to hand only `dag:` to the
 * caller and resolve everything else as one of the note's assets — so a wikilink embed asked the
 * server for `/__board/assets/wiki:Target`, got a 403 and drew a broken image (#396).
 */

const Caller: MarkdownImg = ({ src }: { src?: string }) => createElement("span", { "data-caller-src": src });

const draw = (body: string): string =>
  renderToStaticMarkup(createElement(NoteMarkdown, { name: "Notes/Source", body, components: { img: Caller } }));

describe("a note drawn read-only", () => {
  it("hands a `![[wikilink]]` embed to the caller, never to the asset route", () => {
    const html = draw("![[Target]]");
    expect(html).toContain('data-caller-src="wiki:Target"');
    expect(html).not.toContain("/__board/assets/wiki");
  });

  it("hands a `![…](dag:…)` embed to the caller, as it always has", () => {
    const html = draw("![Target](dag:0123456789)");
    expect(html).toContain('data-caller-src="dag:0123456789"');
  });

  it("still resolves its own pictures relative to its folder", () => {
    const html = draw("![A picture](pic.png)");
    expect(html).toContain('src="/__board/assets/Notes/pic.png"');
  });
});
