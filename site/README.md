# anydag.com

The landing page for AnyDag. It is plain HTML, CSS and JavaScript — no build step, no framework and
no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 4173 --directory site
# then open http://localhost:4173/
```

Opening `index.html` directly works for a quick look, but the bundled fonts need a server: a browser
blocks font files loaded from a `file://` page.

## What is here

| Path | What it is |
|---|---|
| `index.html` | The page: hero, features, screenshots, the licence and data-ownership section, AI, downloads, footer. |
| `styles.css` | The paper and paper-dark palettes from `themes/`, Inter at four weights, and the layout. |
| `main.js` | The theme toggle and the platform label on the download button. |
| `assets/fonts/` | Inter and Fira Code, latin subset, with their OFL licences. |
| `assets/screenshots/` | 1800 px and 900 px WebP captures of the app. |
| `assets/og.png` | The 1200 × 630 social card. |
| `CNAME` | The custom domain GitHub Pages serves it on. |

The theme is chosen before the first paint: a stored choice, otherwise `prefers-color-scheme`. The
download buttons all point at the repository's **Releases** page; the script only changes the label
to the visitor's platform and highlights the matching card. With JavaScript off, the page still
works and the button says *Download the latest release*.

## Screenshots

The screenshots were taken from the app with a temporary study vault (`My notebook`) at 1600 × 1000
and a 1.5 device scale factor, then converted to WebP:

```bash
magick shot.png -resize 1800x -quality 84 assets/screenshots/name-1800.webp
magick shot.png -resize 900x -quality 82 assets/screenshots/name-900.webp
```

They show the note *How memory works*, the *Map of learning* board, the *Memory basics* quiz in
practice, the *Reading list* table, the Tasks board, and the week of 9 November 2026. Recapture them
when the app's chrome or theme changes; keep the alt text describing what the page shows.

## Deploy

`.github/workflows/site.yml` publishes this folder to GitHub Pages on a push to `develop` that
touches `site/`, or by hand from the Actions tab. In the repository settings, set **Pages → Build and
deployment → Source** to **GitHub Actions**, and point the custom domain at `anydag.com`. The
`CNAME` file is already in the artifact.

For any other static host (Cloudflare Pages, Bunny, Netlify, an nginx box), upload the contents of
`site/` as the document root. There is nothing to build.
