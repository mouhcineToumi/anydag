/**
 * KaTeX and its stylesheet, as one chunk. Only ever imported dynamically, by `Math.tsx`, so
 * a page with no equation on it never fetches either. The stylesheet's `@font-face` rules point at
 * KaTeX's own fonts, which the browser fetches face by face as an equation needs them.
 */
import "katex/dist/katex.min.css";

export { default } from "katex";
