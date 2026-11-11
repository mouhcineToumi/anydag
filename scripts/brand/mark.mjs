#!/usr/bin/env node
/**
 * The AnyDag mark, drawn once, written everywhere it appears.
 *
 * The mark is a brush-pen drawing: a frame left open at its top-right corner, and a coil that
 * leaves through the opening toward a dot. Both are drawn with the same pen. The line lands light,
 * swells through the loop and lifts off to a point, and the frame starts and ends with the same
 * taper at the opening. The line thins as it reaches the dot rather than swelling, and it stops
 * short of the dot. That is what keeps it reading as something drawn rather than something thrown.
 *
 * A pen's width changes along the line, which a `stroke-width` cannot do, so every line here is a
 * filled outline: the centre line is sampled, offset either side by half the width at that point,
 * and closed with a round cap at each end. Nothing in the output is a stroke.
 *
 * There are two cuts, as before. The full mark is for anything 24px and up. The favicon cut has a
 * heavier pen with less contrast, so the line's thin ends still show at 16px.
 *
 *   node scripts/brand/mark.mjs
 *
 * writes:
 *   src/ui/markPaths.ts                      the path data `Logo.tsx` draws in currentColor
 *   public/favicon.svg, site/assets/favicon.svg
 *   {docs,site}/assets/logo-{light,dark}.svg, {docs,site}/assets/wordmark-{light,dark}.svg
 * and, when `rsvg-convert` (librsvg) is on the PATH:
 *   desktop/icon.png (512), public/apple-touch-icon.png and site/assets/apple-touch-icon.png (180)
 *
 * The output is deterministic, so a run with no change to this file changes nothing.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The brand's colours, for the files outside src/ (src/ draws in the theme's ink and accent).
const INK = "#1E2430";
const PAPER = "#FBF8F3";
const INK_DARK = "#E9E7E2";
const ACCENT = "#2F6BF0";
const ACCENT_DARK = "#6B9BFF";

// ---------------------------------------------------------------- geometry

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function cubic([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return [
    u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
  ];
}
/** Samples a chain of cubics, each `n` times. */
function sampleCubics(segs, n) {
  const pts = [];
  segs.forEach((seg, i) => {
    for (let k = i === 0 ? 0 : 1; k <= n; k++) pts.push(cubic(seg, k / n));
  });
  return pts;
}
/** Samples the open frame: top edge from `topEnd` leftwards, round the three closed corners, up the right side to `rightEnd`. */
function sampleFrame({ x0, y0, x1, y1, r, topEnd, rightEnd }, n) {
  const pts = [];
  const line = (a, b, m) => {
    for (let k = 0; k < m; k++) pts.push(lerp(a, b, k / m));
  };
  const arc = (cx, cy, from, to) => {
    for (let k = 0; k < n; k++) {
      const a = ((from + ((to - from) * k) / n) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  line([topEnd, y0], [x0 + r, y0], n);
  arc(x0 + r, y0 + r, 270, 180);
  line([x0, y0 + r], [x0, y1 - r], n);
  arc(x0 + r, y1 - r, 180, 90);
  line([x0 + r, y1], [x1 - r, y1], n);
  arc(x1 - r, y1 - r, 90, 0);
  line([x1, y1 - r], [x1, rightEnd], n);
  pts.push([x1, rightEnd]);
  return pts;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Drops the tail of the line inside `clear` of `centre`: where the pen lifts, short of the dot. */
function stopShort(pts, centre, clear) {
  let end = pts.length - 1;
  while (dist(pts[end], centre) < clear) end--;
  return pts.slice(0, end + 1);
}

const f = (n) => {
  const s = n.toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
/**
 * The outline of a line drawn with a pen whose width is `width(t)` at `t` ∈ [0, 1] along it: one
 * closed path, both sides and a round cap at each end.
 */
function ribbon(pts, width) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + dist(pts[i - 1], pts[i]));
  const total = len[len.length - 1];
  const left = [];
  const right = [];
  const half = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const d = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / d;
    const ny = (b[0] - a[0]) / d;
    const h = width(len[i] / total) / 2;
    half.push(h);
    left.push([pts[i][0] + nx * h, pts[i][1] + ny * h]);
    right.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
  }
  const p = (q) => `${f(q[0])} ${f(q[1])}`;
  const end = half[half.length - 1];
  return (
    `M${p(left[0])}L${left.slice(1).map(p).join(" ")}` +
    `A${f(end)} ${f(end)} 0 0 0 ${p(right[right.length - 1])}` +
    `L${right.slice(0, -1).reverse().map(p).join(" ")}` +
    `A${f(half[0])} ${f(half[0])} 0 0 0 ${p(left[0])}Z`
  );
}

// ---------------------------------------------------------------- the pen

/** The line: lands light, swells through the loop, lifts off to a point. */
const brush = (w, lo, hi) => (t) => w * (lo + hi * Math.sin(Math.PI * (0.04 + 0.92 * t)) ** 0.6);
/** The frame: the same pen, tapered where it starts and ends at the opening, full round the corners. */
const framePen = (w, lo) => (t) => w * (lo + (1 - lo) * Math.min(1, t / 0.12, (1 - t) / 0.12) ** 0.7);

// ---------------------------------------------------------------- the two cuts

// The coil, in the 64-unit box the mark has always been drawn in.
const COIL = [
  [
    [16, 44],
    [16, 30],
    [24, 24],
    [32, 28],
  ],
  [
    [32, 28],
    [38, 31],
    [36, 40],
    [30, 40],
  ],
  [
    [30, 40],
    [24, 40],
    [24, 32],
    [30, 26],
  ],
  [
    [30, 26],
    [36, 20],
    [45, 15],
    [53, 11],
  ],
];
// The favicon's coil makes one turn with a wider loop, so the loop stays open at 16px.
const COIL_SMALL = [
  [
    [16, 45],
    [16, 32],
    [26, 27],
    [32, 32],
  ],
  [
    [32, 32],
    [36, 36],
    [31, 42],
    [27, 39],
  ],
  [
    [27, 39],
    [23, 35],
    [31, 27],
    [38, 21],
  ],
  [
    [38, 21],
    [43, 17],
    [49, 13],
    [53, 10],
  ],
];

function cut({ coil, frame, dot, w, gap, line, pen }) {
  const pts = stopShort(sampleCubics(coil, 36), [dot.cx, dot.cy], dot.r + gap + w / 2);
  return {
    frame: ribbon(sampleFrame(frame, 14), pen),
    line: ribbon(pts, line),
    dot,
  };
}

const FULL = cut({
  coil: COIL,
  frame: { x0: 6, y0: 14, x1: 44, y1: 52, r: 9, topEnd: 36.6, rightEnd: 22.8 },
  dot: { cx: 56.4, cy: 9.75, r: 4.8 },
  w: 3.8,
  gap: 2.7,
  line: brush(3.8, 0.35, 1),
  pen: framePen(3.8, 0.55),
});
const SMALL = cut({
  coil: COIL_SMALL,
  frame: { x0: 5, y0: 13, x1: 45, y1: 53, r: 10, topEnd: 33, rightEnd: 26 },
  dot: { cx: 56, cy: 8, r: 5.5 },
  w: 5.6,
  gap: 1.6,
  line: brush(5.6, 0.6, 0.55),
  pen: framePen(5.6, 0.75),
});

// ---------------------------------------------------------------- the files

const mark = (m, ink, accent) =>
  `  <path fill="${ink}" d="${m.frame}"/>\n  <path fill="${ink}" d="${m.line}"/>\n` +
  `  <circle cx="${m.dot.cx}" cy="${m.dot.cy}" r="${m.dot.r}" fill="${accent}"/>\n`;

const logo = (ink, accent) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128" role="img" aria-label="AnyDag">\n${mark(FULL, ink, accent)}</svg>\n`;

const wordmark = (ink, accent) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 64" width="375" height="96" role="img" aria-label="AnyDag">\n${mark(FULL, ink, accent)}` +
  `  <text x="80" y="47" fill="${ink}" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="40" font-weight="600" letter-spacing="-0.5">AnyDag</text>\n</svg>\n`;

const favicon =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="AnyDag">\n` +
  `  <style>\n    :root { --fg: ${INK}; }\n    @media (prefers-color-scheme: dark) { :root { --fg: ${PAPER}; } }\n  </style>\n` +
  mark(SMALL, "var(--fg)", ACCENT) +
  "</svg>\n";

// An app icon is a square of paper with the full mark in the middle of it, at the size the old one was.
const appIcon =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64" fill="${PAPER}"/>\n` +
  `  <g transform="translate(32 32) scale(0.62) translate(-32.5 -29.5)">\n${mark(FULL, INK, ACCENT)}  </g>\n</svg>\n`;

const markPaths = `/**
 * The AnyDag mark's outlines, in its 64-unit box. Generated by \`scripts/brand/mark.mjs\` — edit that
 * and re-run it, never this file. Every line of the mark is a filled outline rather than a stroke,
 * because the pen's width changes along it. \`Logo.tsx\` fills them with \`currentColor\`.
 */
export const MARK_FRAME =
  "${FULL.frame}";
export const MARK_LINE =
  "${FULL.line}";
export const MARK_DOT = { cx: ${FULL.dot.cx}, cy: ${FULL.dot.cy}, r: ${FULL.dot.r} } as const;
`;

const write = (rel, text) => {
  fs.writeFileSync(path.join(ROOT, rel), text);
  console.log(`  ${rel}`);
};
console.log("mark — writing");
write("src/ui/markPaths.ts", markPaths);
for (const dir of ["public", "site/assets"]) write(`${dir}/favicon.svg`, favicon);
for (const dir of ["docs/assets", "site/assets"]) {
  write(`${dir}/logo-light.svg`, logo(INK, ACCENT));
  write(`${dir}/logo-dark.svg`, logo(INK_DARK, ACCENT_DARK));
  write(`${dir}/wordmark-light.svg`, wordmark(INK, ACCENT));
  write(`${dir}/wordmark-dark.svg`, wordmark(INK_DARK, ACCENT_DARK));
}

let rsvg = true;
try {
  execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" });
} catch {
  rsvg = false;
}
if (!rsvg) {
  console.log("rsvg-convert not found: the PNG icons were left as they are");
} else {
  for (const [rel, size] of [
    ["desktop/icon.png", 512],
    ["public/apple-touch-icon.png", 180],
    ["site/assets/apple-touch-icon.png", 180],
  ]) {
    execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", path.join(ROOT, rel)], {
      input: appIcon,
    });
    console.log(`  ${rel}`);
  }
}
