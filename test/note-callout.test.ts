// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CALLOUT_KINDS, calloutKind, calloutLabel, calloutLine, remarkCallouts } from "@/note/callout";
import { blocksToMd, mdToBlocks } from "@/note/markdown";
import { CALLOUT_LOOK, CalloutAside } from "@/render/Callout";

/**
 * A callout drawn read-only — `remarkCallouts` and `CalloutAside`, which every `react-markdown` in
 * the app is handed — and the one rule both it and the note bridge follow: they agree on which
 * quotes are callouts, because both ask `splitCallout`.
 */

const drawn = (md: string): string =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkCallouts], components: { aside: CalloutAside } }, md),
  );

const html = (md: string): Document => new DOMParser().parseFromString(drawn(md), "text/html");

describe("the kinds", () => {
  it("draws every kind in one of the theme's hues, or in none", () => {
    const hues = ["indigo", "teal", "coral", "spruce", "ochre", "violet", "crimson", "moss", "magenta", "bronze"];
    for (const k of CALLOUT_KINDS) {
      const hue = CALLOUT_LOOK[k].hue;
      expect(hue === null || hues.includes(hue), k).toBe(true);
    }
  });

  it("follows Obsidian's aliases, and draws a word nobody knows as a note", () => {
    expect(calloutKind("hint")).toBe("tip");
    expect(calloutKind("ERROR")).toBe("danger");
    expect(calloutKind("tldr")).toBe("abstract");
    expect(calloutKind("cite")).toBe("quote");
    expect(calloutKind("aside")).toBe("note");
    expect(calloutKind("CAUTION")).toBe("caution");
  });

  it("heads an untitled callout with its own word", () => {
    expect(calloutLabel("NOTE")).toBe("Note");
    expect(calloutLabel("aside")).toBe("Aside");
  });

  it("writes its first line with one space before the title and none when there is none", () => {
    expect(calloutLine("tip", "-", "  A  title ")).toBe("[!tip]- A title");
    expect(calloutLine("NOTE", "", "")).toBe("[!NOTE]");
  });
});

describe("the read-only drawing", () => {
  it("draws a callout with its kind, its icon, its title and its body", () => {
    const doc = html("> [!warning] Breaking change\n> The route is **gone**.");
    const box = doc.querySelector(".dag-callout");
    expect(box?.getAttribute("data-dag-callout")).toBe("warning");
    expect(box?.tagName).toBe("DIV");
    expect(box?.querySelector(".dag-callout__icon svg")).not.toBeNull();
    expect(box?.querySelector(".dag-callout__title")?.textContent).toBe("Breaking change");
    expect(box?.querySelector(".dag-callout__body")?.innerHTML.trim()).toBe("<p>The route is <strong>gone</strong>.</p>");
    expect(box?.getAttribute("style")).toContain("--callout-h:var(--dag-color-hues-ochre)");
  });

  it("heads an untitled callout with its word, and an unknown one as a note under its own word", () => {
    expect(html("> [!NOTE]\n> x").querySelector(".dag-callout__title")?.textContent).toBe("Note");
    const aside = html("> [!aside]\n> x").querySelector(".dag-callout");
    expect(aside?.getAttribute("data-dag-callout")).toBe("note");
    expect(aside?.querySelector(".dag-callout__title")?.textContent).toBe("Aside");
  });

  it("draws Markdown in a title", () => {
    expect(html("> [!info] The *real* title\n> x").querySelector(".dag-callout__title")?.innerHTML).toBe(
      "The <em>real</em> title",
    );
  });

  it("folds with the browser's own details: `-` shut, `+` open", () => {
    const shut = html("> [!faq]- Why?\n> Because.").querySelector(".dag-callout");
    expect(shut?.tagName).toBe("DETAILS");
    expect(shut?.hasAttribute("open")).toBe(false);
    expect(shut?.querySelector(":scope > summary .dag-callout__title")?.textContent).toBe("Why?");
    const open = html("> [!faq]+ Why?\n> Because.").querySelector(".dag-callout");
    expect(open?.hasAttribute("open")).toBe(true);
  });

  it("draws a callout inside a list and inside a quote", () => {
    expect(html("- item\n\n  > [!tip] In a list\n  > x").querySelector("li .dag-callout")).not.toBeNull();
    expect(html("> outer\n>\n> > [!bug] Inner\n> > x").querySelector("blockquote .dag-callout")).not.toBeNull();
  });

  it("leaves a plain quote a quote", () => {
    expect(drawn("> one\n> two")).toBe("<blockquote>\n<p>one\ntwo</p>\n</blockquote>");
    expect(drawn("> [!two words] text")).toContain("<blockquote>");
  });
});

describe("the bridge and the drawing", () => {
  const bodies = [
    "> [!note] a\n> b",
    "> [!NOTE]\n> b",
    "> [!tip]- t\n> b",
    "> [!x]",
    "> plain",
    "> [!note] title\\\n> hard break",
    "> **[!note]** bold marker",
    "> [!note] a [link\n> over two](https://x.test) lines",
    "> [!note] code `over\n> two` lines",
    "> [!note]text",
    "> [!two words] x",
  ];
  for (const md of bodies) {
    it(`agree on whether ${JSON.stringify(md)} is a callout`, () => {
      const bridge = mdToBlocks(md)[0]?.type === "callout";
      const page = html(md).querySelector(".dag-callout") !== null;
      expect(page).toBe(bridge);
    });
  }

  it("draws a rewritten callout as it drew the one it was read from", () => {
    for (const md of [
      "> [!tip]   Spaced   title  \n> body",
      "> [!caution]\n>\n> Mind the gap.",
      "> [!example]+ A\n> - one\n> - two",
    ]) {
      expect(drawn(blocksToMd(mdToBlocks(md))).replace(/\s+/g, " ")).toBe(drawn(md).replace(/\s+/g, " "));
    }
  });
});
