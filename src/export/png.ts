/**
 * An SVG document as a PNG.
 *
 * The SVG the exporter produces is self-contained — fonts and images as data URIs, styles
 * resolved — which is exactly the condition under which a browser will paint it into a canvas
 * without tainting it: nothing in the file reaches out to a network. So the raster is one
 * `<img>` load and one `drawImage`, at whatever scale a screen deserves.
 */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  /* A data URL, not a blob URL. The file is the same; the difference is what Chrome makes of it:
     an SVG with `<foreignObject>` loaded from a blob taints the canvas it is drawn on, and a
     tainted canvas cannot be read back — while the same bytes as a data URL draw clean. */
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("the SVG could not be rasterised"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the canvas gave no PNG"))), "image/png"),
    );
  }
}
