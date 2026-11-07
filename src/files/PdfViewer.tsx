/**
 * A PDF, drawn in the page by pdf.js.
 *
 * **pdf.js and not the browser's own viewer**, and the reasons are the three places the browser's
 * would have failed: Chrome refuses its viewer inside the sandbox attachments are served under,
 * iOS Safari draws the first page of one in a frame and stops, and a headless snapshot draws
 * nothing at all. This draws the same pages, the same way, in all three.
 *
 * **Loaded the first time a PDF is opened**, never before: this module is a lazy chunk
 * (`Preview.tsx`), and pdf.js's worker is a file of its own that the browser fetches only then. A
 * board, a note and a snapshot of either never pay for it.
 *
 * Each page is a canvas drawn at the width of the column and the density of the screen, and **only
 * once it is near the view** — a two-hundred-page report opened to read its summary draws its first
 * pages and not the rest. The zoom scales that width; the page count and the pages drawn are said on
 * the element (`data-dag-pdf-pages`, `data-dag-pdf-drawn`), which is what a check waits on.
 */
import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
/* The **legacy** build, which is pdf.js with its polyfills: the modern one calls
   `Map.prototype.getOrInsertComputed`, which a Chromium from 2025 does not have, and threw on the
   first page — a preview that works only in the newest browsers is not one worth having. */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** The zooms a person steps through, as a fraction of the column's width. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** How far outside the view a page starts being drawn, so scrolling finds it ready. */
const AHEAD = "600px 0px";

export default function PdfViewer({ url, title, onReady }: { url: string; title: string; onReady?(): void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(2);
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    let live = true;
    /* A task let go of below is destroyed with the document it made, so a page opened and left does
       not keep a worker busy. */
    const task = getDocument({ url, useSystemFonts: true });
    task.promise.then(
      (d) => live && setDoc(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      void task.destroy();
    };
  }, [url]);

  /* The column's width, which a page is drawn to fill at 100%. */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (doc && drawn > 0) onReady?.();
  }, [doc, drawn, onReady]);

  const scale = ZOOMS[zoom] ?? 1;
  if (failed)
    return (
      <p className="dag-file__none" data-dag-pdf-failed="">
        This PDF could not be read. Download it to open it elsewhere.
      </p>
    );
  return (
    <div
      className="dag-pdf"
      data-dag-pdf={doc ? doc.numPages : "loading"}
      data-dag-pdf-pages={doc?.numPages}
      data-dag-pdf-drawn={drawn}
    >
      <div className="dag-pdf__bar" role="toolbar" aria-label={`${title}: zoom`}>
        <span className="dag-pdf__count">{doc ? `${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}` : "Opening…"}</span>
        <button
          type="button"
          className="dag-icon"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom === 0}
          onClick={() => setZoom((z) => Math.max(0, z - 1))}
        >
          <Minus size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="dag-pdf__zoom" data-dag-pdf-zoom={Math.round(scale * 100)}>
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="dag-icon"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom === ZOOMS.length - 1}
          onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="dag-pdf__pages" ref={box}>
        {doc && width > 0
          ? Array.from({ length: doc.numPages }, (_, i) => (
              <Page key={i} doc={doc} n={i + 1} width={Math.round(width * scale)} onDrawn={() => setDrawn((d) => d + 1)} />
            ))
          : null}
      </div>
    </div>
  );
}

/**
 * One page: a canvas the size the page will be, drawn when it comes near the view. The size is
 * known before the drawing — from the page's own proportions — so the scroll does not jump as pages
 * arrive.
 */
function Page({ doc, n, width, onDrawn }: { doc: PDFDocumentProxy; n: number; width: number; onDrawn(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(n === 1);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || near) return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && setNear(true), { rootMargin: AHEAD });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    let live = true;
    void doc.getPage(n).then((page) => {
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
    });
    return () => {
      live = false;
    };
  }, [doc, n]);

  useEffect(() => {
    const el = canvas.current;
    if (!near || !el || !ratio) return;
    let live = true;
    let render: { cancel(): void; promise: Promise<void> } | null = null;
    void doc.getPage(n).then((page) => {
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      const density = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * density });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      render = page.render({ canvas: el, viewport });
      render.promise.then(
        () => live && onDrawn(),
        () => undefined,
      );
    });
    return () => {
      live = false;
      render?.cancel();
    };
    /* `onDrawn` is a fresh closure each render and says the same thing; drawing again for it would
       draw every page on every page that lands. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, n, width, near, ratio]);

  const height = ratio ? Math.round(width * ratio) : Math.round(width * 1.294);
  return (
    <canvas
      ref={canvas}
      className="dag-pdf__page"
      data-dag-pdf-page={n}
      style={{ width, height }}
      aria-label={`Page ${n}`}
      role="img"
    />
  );
}
