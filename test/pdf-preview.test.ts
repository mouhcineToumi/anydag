import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FilePreview, preloadPdfViewer } from "@/files/Preview";

/**
 * A PDF's viewer, drawn in the render that asks for it once its chunk has come (#129).
 *
 * It was a `React.lazy`, and a lazy suspends the first time it renders even when its module has
 * long since loaded; React then holds the boundary's content back until 300 ms after the fallback
 * went up. That was most of the first PDF of a session taking 430 ms to draw. The server renderer
 * runs no effects, so what it draws is exactly what the first render draws.
 */

const pdf = () =>
  renderToStaticMarkup(
    createElement(FilePreview, {
      name: "Q3 Report.pdf",
      title: "Q3 Report",
      url: "/__board/file?id=x",
      download: "/__board/file?id=x&download=1",
    }),
  );

describe("the PDF preview", () => {
  /* One test, and the first render of a PDF in this module's life: a lazy that had rendered once
     before, and suspended then, would have resolved by now and drawn the viewer too. */
  it("draws the viewer itself in the first render after the chunk has come", async () => {
    await preloadPdfViewer();
    const markup = pdf();
    expect(markup).not.toContain('data-dag-pdf="loading"></div>');
    expect(markup).toContain('class="dag-pdf__bar"');
    expect(markup).toContain('aria-label="Q3 Report: zoom"');
  });
});
