/**
 * Print what the page has set out for paper, under a title — which is how a note becomes a PDF
 *.
 *
 * **The browser's own print, and not a PDF library, on purpose.** A library draws the page again:
 * either as a picture of it, so the text in the PDF is pixels nobody can search, select or zoom; or
 * by laying the Markdown out a second time with a second idea of what a heading looks like. Printing
 * lays it out with the engine that drew it on screen, keeps the text as text and the links as links,
 * and "Save as PDF" is a destination every desktop browser offers. What it costs is the dialog in
 * between, which is also where a person picks the paper size.
 *
 * The title is what the browser offers as the PDF's file name, so it is the document's for the length
 * of the print and the page's again after. `print()` blocks until the dialog closes in Chromium and
 * WebKit, and Firefox takes its copy of the page before it returns, so putting it back straight away
 * is safe in all three.
 */
export function printAs(title: string): void {
  const was = document.title;
  document.title = title;
  try {
    window.print();
  } finally {
    document.title = was;
  }
}
