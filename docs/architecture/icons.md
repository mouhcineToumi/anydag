# Icons

> Four vocabularies behind one `icon=` attribute, and where the art lives.

## Icons

Four vocabularies, one attribute. `icon=server` is a Lucide glyph for a *kind*; `icon=postgresql`
is the brand in its own colours; `icon=mono:postgresql` is the brand as a silhouette wearing the
node's hue; `icon=aws:lambda` is a cloud service; and `icon=emoji:house` is a picture — every
Unicode emoji, Fluent's, loaded on demand, `mono:emoji:house` in the hue (see *Pictures*).
`icons/README.md` is the full account — read it before touching anything under `icons/`.

Five things are load-bearing:

- **The art is fetched when something draws it; the names are always there.** `src/render/art.ts`
  loads four files on demand — `icons.json`, every Lucide glyph, and the emoji's two cuts — and
  `src/render/icon-index.ts` (generated, about 60 KB) holds which names each set has, so `iconFor`
  still decides synchronously and `DiagramItem` holds `data-dag-ready` until the files its model
  draws from have landed. The page's first chunk was 4.1 MB (1.2 MB gzipped) while the logos and
  `import * as icons from "lucide-react"` were in it, and is 0.9 MB (0.3 MB) without them. Every pack
  is still all there for the library, the picker and the drawing. The chrome's own glyphs stay named
  imports. `check-icons.mjs` holds the index to the bundle and to the installed `lucide-react`.
- **The artwork lives outside `src/` because `check-literals.mjs` scans `src/` for colour.** A brand
  logo is nothing but colours the theme does not own, so `icons/data/*.json` is data the renderer
  imports rather than style, and the no-colour rule survives intact instead of gaining an exception.
- **A brand mark is drawn unmodified, and that is a licence constraint as much as a design one.**
  Azure's terms say "don't distort or change icon shape in any way"; AWS's own redistribution is
  CC-BY-**ND**. Tinting a vendor icon through `hueVars()` would be a derivative work — so `brand` is
  a separate mode with a neutral tile and the hue moved to the card border, and the design decision
  and the licence agree. `mono:` is CC0-only for the same reason. See `icons/NOTICE`.
- **`replaceIDs()` runs per rendered instance, never at build time.** 998 of the 1140 colour marks
  carry a `<linearGradient>` or `<mask>` whose id is fixed in the data, so two Azure cards on one
  board would both define it and the second would resolve `url(#…)` to the first one's element.
  Worse, 84 ids are shared across *different* icons — `azure:intune`, `azure:intune-app-protection`
  and `azure:intune-for-education` ship the same three gradient UUIDs. Prefixing per icon at build
  time fixes only the second case; per-instance replacement at the mount point fixes both, and is
  also what makes an exported standalone SVG internally consistent.
- **`brandTile` is a light surface in every theme, dark ones included.** Brand marks are drawn for
  light backgrounds; on the dark theme's own `paper100`, Express vanished completely and Vercel's
  triangle was a shape you had to hunt for.

Two smaller ones. The build prefers a `-icon` sibling over a wordmark — `logos` ships `docker` as
the whale *beside the word*, and at 8.8:1 `anthropic` printed straight across the card it belonged
to. And a brand beats a Lucide glyph where both claim a name; `check-icons.mjs` prints that overlap
(five names today) on every run, because the day a sixth arrives some board's concept glyph silently
becomes a logo.

`npm run icons:build` regenerates `icons/data/*`, `src/dsl/icon-names.ts` — the DSL needs the
name list to report `W_UNKNOWN_ICON`, and it is the one layer that must stay loadable by plain Node —
and `src/render/icon-index.ts` (`scripts/icons/index.mjs`, also runnable alone).

**The vocabulary has a route: `GET /__board/icons`.** `/dsl` serves the grammar and `/library` the
parts; this is the third thing an agent cannot invent, because `ICON_NAMES` was read only by the two
validators that use it to say no — `dbt` and `gcp:bigquery` both exist and nothing outside one
person's memory said so. The payload is `{ icons: [{ name, mode }], total, returned, truncated }`,
where `mode` is what the name resolves to — `brand` (own colours, neutral tile), `mono`
(silhouette, inherits the hue) or `concept` (Lucide, `currentColor`) — which is not inferable from
the spelling and is what decides how it draws. `?q=` narrows by substring before ~2,900 names have
to travel, `?mode=` to one way of drawing, and a truncated answer says so (`total` versus
`returned`) rather than reading as the whole set; no SVG bodies, it is a vocabulary not artwork.
`plugins/icons.ts` derives the modes from the bundle's own maps in `iconFor()`'s order — alias,
colour, silhouette, concept by elimination — instead of restating them, so the route and the
renderer cannot disagree. `W_UNKNOWN_ICON` suggests on the same principle the other closed
vocabularies do (`src/dsl/suggest.ts`'s `suggestIcon`): `icon=postgre` names `postgres`, a
`mono:`/`lucide:` prefix rides back on the suggestion, and a small alias table answers the words
edit distance cannot reach — `lambda` → `aws:lambda`, `py` → `python` rather than `pg`.
