/**
 * How the block editors read a paste — the note's and a quiz field's alike.
 *
 * **Pasted Markdown goes through remark, never through BlockNote's parser.** Its parser is the one the
 * notes feature was built around avoiding — it reads every wrapped line as a hard break. So
 * `text/plain` is converted by `mdToBlocks` and inserted as BlockNote's own HTML; HTML from another
 * app, and BlockNote's own clipboard, go through the default handler with its Markdown sniffing off.
 * `pasteKind` (`menus.ts`) is the decision, testable without a browser.
 */
import { mdToBlocks } from "@/note/markdown";

import { pasteKind } from "./menus";

interface PasteContext {
  event: ClipboardEvent;
  editor: { pasteHTML(html: string): void; blocksToHTMLLossy(blocks: never): string };
  defaultPasteHandler(o?: { prioritizeMarkdownOverHTML?: boolean; plainTextAsMarkdown?: boolean }): boolean | undefined;
}

export function markdownPaste({ event, editor, defaultPasteHandler }: PasteContext): boolean | undefined {
  const data = event.clipboardData;
  if (!data) return defaultPasteHandler();
  if (pasteKind(Array.from(data.types), data.getData("text/html")) === "markdown") {
    const text = data.getData("text/plain");
    if (!text) return false;
    editor.pasteHTML(editor.blocksToHTMLLossy(mdToBlocks(text) as never));
    return true;
  }
  return defaultPasteHandler({ prioritizeMarkdownOverHTML: false, plainTextAsMarkdown: false });
}
