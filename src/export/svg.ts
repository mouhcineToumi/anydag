/**
 * One board item, as a standalone SVG file.
 *
 * The renderer draws a diagram as DOM cards with an SVG overlay for the edges — that is the whole
 * architecture, and it is the right one, because HTML lays text out and SVG does not. It does mean
 * there is no SVG to hand out: the picture only exists as the browser's composite of the two.
 *
 * So the export wraps the real DOM in `<foreignObject>` and freezes everything it depends on into
 * the file. What comes out is pixel-faithful by construction — it is the same DOM, rendered by the
 * same engine — and opens in any browser and any docs site. It will not open in Figma or
 * Illustrator, which do not implement `foreignObject`. That is a real limit and the honest trade:
 * the alternative is a second renderer drawing every node kind as SVG primitives with its own text
 * wrapping, which is the size of the original build.
 *
 * Three things have to be frozen, because an SVG file has no page around it to inherit from:
 *
 * 1. **Styles.** Every rule that applies, resolved. `getComputedStyle` gives the final value of
 *    every property, which also resolves every `var(--dag-*)` — so the export carries no theme, it
 *    carries the answer the theme gave. That is what makes it survive being opened anywhere.
 * 2. **Fonts.** The face itself, as a data URI, or the file falls back to Times on a machine that
 *    has never seen Inter and the layout — which was measured against Inter — is wrong.
 * 3. **Images.** Same reason: a `/__board/assets/…` URL means nothing outside the dev server.
 */

/**
 * The properties worth carrying.
 *
 * Not "everything `getComputedStyle` returns": that is ~340 properties per element, most of them
 * initial values, and on a forty-node diagram it produces a megabyte of noise that also defeats
 * every inherited value. This is the set the stylesheets actually use.
 */
const PROPS = [
  "box-sizing", "display", "position", "top", "right", "bottom", "left",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "padding", "overflow", "flex", "flex-direction", "flex-wrap",
  "align-items", "align-self", "justify-content", "gap", "order",
  "background", "background-color", "background-image", "border", "border-radius",
  "box-shadow", "opacity", "color", "fill", "stroke", "stroke-width", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin", "paint-order", "transform", "transform-origin",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
  "text-align", "text-anchor", "text-decoration", "text-transform", "white-space",
  "overflow-wrap", "vertical-align", "list-style", "dominant-baseline", "visibility",
] as const;

/** The four sides of `border`, for an element whose sides differ. */
const SIDES = ["border-top", "border-right", "border-bottom", "border-left"] as const;

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function toDataUri(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error(`could not read ${url}`));
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Every `@font-face` the page actually used, with the file inlined.
 *
 * The filter matters more than it looks. `@fontsource` ships one file per weight *per unicode
 * range* — latin, latin-ext, greek, cyrillic, vietnamese — so Inter at four weights plus Fira Code
 * at three is forty-nine faces, and embedding all of them makes a 960KB file for a diagram whose
 * text is entirely Latin. `document.fonts` reports which faces the browser resolved to render this
 * page, and that is the answer: matching against the loaded set brings it under a tenth of that.
 *
 * A rule whose file cannot be fetched is dropped rather than emitted broken — a missing face falls
 * back to the next in the stack, while a broken `src` can make a renderer discard the whole
 * stylesheet.
 */
function used(): Set<string> {
  const key = (family: string, weight: string, style: string, range: string) =>
    [family.replace(/["']/g, "").trim().toLowerCase(), weight, style, range].join("|");
  const out = new Set<string>();
  for (const face of Array.from(document.fonts)) {
    if (face.status === "loaded") out.add(key(face.family, face.weight, face.style, face.unicodeRange));
  }
  return out;
}

async function fontFaces(): Promise<string> {
  const loaded = used();
  const out: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      /* A cross-origin stylesheet. Nothing we can read, and nothing we ship depends on one. */
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      const weight = rule.style.getPropertyValue("font-weight") || "normal";
      const style = rule.style.getPropertyValue("font-style") || "normal";
      const range = rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF";
      if (!loaded.has([family.toLowerCase(), weight, style, range].join("|"))) continue;

      const src = rule.style.getPropertyValue("src");
      const url = /url\((["']?)([^)"']+)\1\)/.exec(src)?.[2];
      if (!url) continue;
      const data = await toDataUri(new URL(url, location.href).href);
      if (!data) continue;

      out.push(
        `@font-face{font-family:'${family}';src:url(${data});font-weight:${weight};font-style:${style};unicode-range:${range}}`,
      );
    }
  }
  return out.join("\n");
}

/**
 * Properties an SVG element may take from a stylesheet.
 *
 * Deliberately tiny, and the reason is a bug worth remembering. The first version inlined the full
 * HTML property list onto every element including SVG ones, and wrote each icon's *computed* `fill`
 * — which, for a Lucide glyph that sets no fill and is drawn entirely with strokes, is the initial
 * value, black. Every icon in the export came out as a solid black rectangle.
 *
 * An SVG element already carries its own geometry and paint as attributes, put there by the
 * renderer. The only things it needs from CSS are the ones a class actually sets: edge labels get
 * their font and fill from `.dag-edge-label`, axis labels from `.dag-axis__label`.
 */
const SVG_PROPS = ["fill", "stroke", "stroke-width", "paint-order", "font-family", "font-size", "font-weight", "opacity"] as const;

const isSvg = (el: Element): boolean => el.namespaceURI === "http://www.w3.org/2000/svg";

/**
 * Which properties an element needs.
 *
 * A root `<svg>` — one whose parent is HTML — is a box in the HTML layout as well as a drawing
 * surface, and the edge overlay is exactly that: `.dag-edges` takes `position: absolute` and
 * `overflow: visible` from a stylesheet, and without them it lays out in flow and clips every
 * curve. Withholding the box properties from it dropped every edge from the export.
 *
 * A nested SVG element is only ever painted, so it gets the short list. Either way an attribute the
 * renderer wrote beats a computed value, which is what keeps a Lucide glyph's `fill="none"`.
 */
const propsFor = (el: Element): readonly string[] => {
  if (!isSvg(el)) return PROPS;
  const root = !el.parentElement || !isSvg(el.parentElement);
  return root ? [...PROPS, ...SVG_PROPS] : SVG_PROPS;
};

/** Copy the resolved value of every property we care about onto the clone. */
function inlineStyles(source: Element, clone: Element): void {
  const from = Array.from(source.querySelectorAll("*"));
  const to = Array.from(clone.querySelectorAll("*"));

  const apply = (src: Element, dst: Element) => {
    const computed = getComputedStyle(src);
    const decl: string[] = [];

    for (const prop of propsFor(src)) {
      /* An attribute the renderer wrote is the author's intent; the computed value is merely what
         the cascade made of it, and for an unset property that is the initial value. Never overrule
         an attribute with one. */
      if (isSvg(src) && src.hasAttribute(prop)) continue;
      const value = computed.getPropertyValue(prop);
      /* `border` reads as nothing when the four sides differ — and a fraction's bar in an equation
 is a bottom border and nothing else. Then the sides that are drawn go one by one. */
      if (prop === "border" && !value) {
        for (const side of SIDES) {
          const one = computed.getPropertyValue(side);
          if (one && !/\bnone\b/.test(one) && !/^0px\b/.test(one)) decl.push(`${side}:${one}`);
        }
        continue;
      }
      /* `none`/`normal`/`auto` are the initial value of almost everything here; writing them out
         triples the file and, worse, blocks inheritance from a parent that did set one. */
      if (!value || value === "none" || value === "normal" || value === "auto") continue;
      decl.push(`${prop}:${value}`);
    }

    /* Always replace, never merge. The clone carries whatever inline style the renderer wrote —
       including the `--dag-h` custom properties `hueVars()` binds — and those reference variables
       that will not exist in a file with no `<html>` above it. */
    if (decl.length) dst.setAttribute("style", decl.join(";"));
    else dst.removeAttribute("style");

    /* An attribute still naming a variable would resolve to nothing. The renderer uses them for
       per-instance colour (`stroke="var(--dag-color-hues-teal)"`), so resolve rather than drop: the
       computed value is what it meant. */
    for (const attr of Array.from(dst.attributes)) {
      if (!attr.value.includes("var(--")) continue;
      const resolved = computed.getPropertyValue(attr.name);
      if (resolved && resolved !== "none") dst.setAttribute(attr.name, resolved);
      else dst.removeAttribute(attr.name);
    }
  };

  apply(source, clone);
  for (let i = 0; i < from.length && i < to.length; i++) apply(from[i]!, to[i]!);
}

export interface SvgOptions {
  /** Board-space size of the item, i.e. its size at zoom 1. */
  width: number;
  height: number;
  /** Goes into `<title>`, which is what a screen reader and a file manager read. */
  title: string;
}

/**
 * One `.dag-item`, frozen: its styles resolved, its images inlined, its editing chrome gone. The
 * XHTML that goes inside a `<foreignObject>`; the caller decides where.
 */
async function freeze(el: HTMLElement): Promise<string> {
  const clone = el.cloneNode(true) as HTMLElement;

  /*
   * Style first, prune second, and never the other way round.
   *
   * `inlineStyles` walks the source and the clone in parallel and pairs them by index, which only
   * holds while the two trees are the same shape. Removing the chip from the clone before inlining
   * shifted every element after it by its own size, so each one was given its neighbour's style:
   * icons came out as black rectangles wearing a card's geometry, and card text vanished. The
   * output was a valid SVG file that looked plausible at a glance, which is exactly the failure a
   * serialiser makes.
   */
  inlineStyles(el, clone);
  for (const chrome of Array.from(clone.querySelectorAll(".dag-handle, .dag-connect-handle, .dag-export, .dag-code__copy"))) chrome.remove();
  clone.removeAttribute("data-dag-movable");
  clone.removeAttribute("data-dag-selected");
  clone.removeAttribute("data-dag-drop");
  /* `inlineStyles` writes the live transform back over the two lines above, so reset after. */
  clone.style.transform = "none";
  clone.style.position = "static";
  clone.style.outline = "none";

  /* Images have to travel with the file; a board asset URL means nothing outside the dev server. */
  const sourceImgs = Array.from(el.querySelectorAll("img"));
  const cloneImgs = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    sourceImgs.map(async (img, i) => {
      const data = await toDataUri(img.currentSrc || img.src);
      if (data) cloneImgs[i]?.setAttribute("src", data);
    }),
  );

  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Serialise one `.dag-item` to an SVG document.
 *
 * The element is measured and styled in place — it has to be on screen and settled, which it is,
 * because this is driven by a button on the item itself.
 */
export async function itemToSvg(el: HTMLElement, { width, height, title }: SvgOptions): Promise<string> {
  const xhtml = await freeze(el);
  const css = await fontFaces();

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(title)}</title>`,
    css ? `<style>${css}</style>` : "",
    `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
    xhtml,
    `</foreignObject>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface BoardPart {
  el: HTMLElement;
  /** Board-space box, at zoom 1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A whole board — or any set of its items — as one SVG document.
 *
 * Each item is its own `<foreignObject>` at its board position, offset so the first pixel of
 * content is the margin; the fonts are embedded once for all of them, which is the reason this is
 * not a loop over `itemToSvg`: forty items would carry forty copies of Inter.
 */
export async function boardToSvg(
  parts: BoardPart[],
  { title, margin, overlay, paper = true }: { title: string; margin: number; overlay?: BoardPart; paper?: boolean },
): Promise<string> {
  if (parts.length === 0) throw new Error("nothing to export");
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.width);
    y1 = Math.max(y1, p.y + p.height);
  }
  const width = Math.ceil(x1 - x0 + margin * 2);
  const height = Math.ceil(y1 - y0 + margin * 2);

  const bodies = await Promise.all(parts.map((p) => freeze(p.el)));
  /*
   * The links between items, if the board has any.
   *
   * Deliberately outside the bounds above. The layer reaches a control arm's worth of paper past
   * every item so a curve is never clipped, and letting that set the page would put a wide empty
   * border on every export that happens to contain a link. It is drawn last, which is where it
   * sits on the page.
   */
  const over = overlay ? await freeze(overlay.el) : null;
  const css = await fontFaces();
  const ground = getComputedStyle(document.documentElement).getPropertyValue("--dag-color-paper").trim();

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(title)}</title>`,
    css ? `<style>${css}</style>` : "",
    /* The paper, so the file reads on any background the way the board does — unless somebody has
       turned it off, which is what putting a board onto a dark slide wants. One item exported from
       its own chip has never had any, and still does not. */
    paper && ground ? `<rect width="${width}" height="${height}" fill="${escapeXml(ground)}"/>` : "",
    ...parts.map(
      (p, i) =>
        `<foreignObject x="${Math.round(p.x - x0 + margin)}" y="${Math.round(p.y - y0 + margin)}" width="${Math.ceil(p.width)}" height="${Math.ceil(p.height)}">${bodies[i]}</foreignObject>`,
    ),
    over && overlay
      ? `<foreignObject x="${Math.round(overlay.x - x0 + margin)}" y="${Math.round(overlay.y - y0 + margin)}" width="${Math.ceil(overlay.width)}" height="${Math.ceil(overlay.height)}" style="overflow:visible">${over}</foreignObject>`
      : "",
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}
