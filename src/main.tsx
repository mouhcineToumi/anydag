import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";

/**
 * Every face a card can be measured in, asked for by name before the first render.
 *
 * `document.fonts.ready` waits only for the faces the page has already asked for, and a page asks
 * for a face when it draws text in it. A diagram's cards are measured on a canvas *before* they are
 * drawn, so a face nothing on the page had drawn yet was not loaded when they were measured, and they
 * were sized in the fallback for good. On an editor page the chrome's mono labels used to ask for
 * Fira Code by accident; once they moved to Inter, every card came out a few pixels narrow. The
 * read-only pages — `?view=1`, a share link, `?snapshot=1` — draw no chrome, never had the faces in
 * flight, and had been measuring meta lines, rows and labels in the fallback all along: the reference
 * screenshots of `architecture`, `c4`, `gitgraph` and `workflow` were taken that way.
 *
 * So the faces are named here, the ones imported above, and loaded on every page. `"Ag"` selects the
 * latin subset of each, which is what a card is set in; another script's subset is still asked for
 * when text in it is drawn.
 */
const FACES = [
  '400 16px "Inter"',
  '500 16px "Inter"',
  '600 16px "Inter"',
  '700 16px "Inter"',
  '400 16px "Fira Code"',
  '500 16px "Fira Code"',
  '600 16px "Fira Code"',
];

const facesLoaded = (): Promise<unknown> =>
  Promise.all(FACES.map((face) => document.fonts.load(face, "Ag").catch(() => undefined))).then(() => document.fonts.ready);

import { me } from "./auth/api";
import { Boundary } from "./ui/Boundary";
import { preloadEditor } from "./blocks";
import { Gate } from "./auth/Gate";
import { warmLayout } from "./layout/elk";
import { watchZone } from "./calendar/usePrefs";
import { pull } from "./settings/sync";
import { startTelemetry } from "./telemetry/client";
import { loadVaults } from "./vault/api";
import { settleVault, watchVault } from "./vault/current";
import { watchWindowInset } from "./ui/windowInset";
import "./styles/base.css";
import "./styles/chrome.css";
import "./styles/canvas.css";
import "./styles/nodes.css";
import "./styles/markdown.css";
import "./styles/items.css";

/**
 * Wait for two things before the first render, and both are load-bearing.
 *
 * **The webfonts.** Sizing measures text, so a layout computed against the fallback face is a
 * *different layout* — every card a few percent wrong. Measuring twice and re-laying out is the
 * obvious alternative and it is worse: the diagram visibly resizes after paint, and a screenshot
 * taken in between catches neither state. One measurement regime, at the cost of a blank frame on
 * a local tool.
 *
 * **And the local user**, plus their settings. Every preference in the app is
 * read once from `localStorage` by whichever component owns it, so the account's copy has to be in
 * place before any of them mounts; doing it afterwards would mean five components subscribing to a
 * change they otherwise have no reason to know about. The two waits run together, because neither
 * needs the other.
 *
 * Neither failing takes the page down. No font API, a face that never resolves, an API that is not
 * answering: render anyway and let `Gate` say so, rather than show nothing at all.
 */
/**
 * What the page will want first, asked for the moment the session is known to be there.
 *
 * `Gate` loads the canvas lazily and a note's page loads the editor lazily, and both used to be
 * requested only once the fonts, the session, the workspaces and the preferences had all come back:
 * round trips with nothing else on the wire. A later `import()` of the same module is the one
 * already on its way, so nothing is fetched twice. Not for the read-only view or the consent card,
 * which draw neither, and not before the session, because a sign-in card needs none of it.
 *
 * The layout worker is `start()`'s to begin for a board, before anything is asked: a board lays
 * something out the moment it is drawn, and this is where the worker used to start by being
 * imported. Every other page starts it once it is ready, or five seconds in — off the path of what
 * that page was waiting for, and warm by the time a board is opened from it.
 */
function preload(): void {
  const q = new URLSearchParams(location.search);
  const view = q.get("view") === "1";
  if (!view) void import("./App");
  if (!view && q.get("note")) void preloadEditor();
  if (q.get("board")) return;
  const root = document.documentElement;
  const later = () => {
    ready.disconnect();
    clearTimeout(timer);
    warmLayout();
  };
  const ready = new MutationObserver(() => root.dataset.dagReady === "1" && later());
  ready.observe(root, { attributes: true, attributeFilter: ["data-dag-ready"] });
  const timer = setTimeout(later, 5_000);
}

/** The picker for when no vault is open: a chunk of its own, so a page that has a vault never fetches it. */
const NoVaultPage = lazy(() => import("./ui/NoVaultPage").then((m) => ({ default: m.NoVaultPage })));

async function start(): Promise<void> {
  if (new URLSearchParams(location.search).get("board")) warmLayout();

  /* Before the first request, so that every one of them says which vault it is about. */
  watchVault();
  /* Before the first paint, so the top row never draws under the macOS traffic lights. */
  watchWindowInset();

  const [, account] = await Promise.all([
    facesLoaded().catch(() => undefined),
    me()
      .then((account) => {
        if (account) preload();
        return account;
      })
      .catch(() => null),
  ]);
  let id = "";
  if (account) {
    /* Which vault this tab is in is settled before the preferences are pulled, because half of them
       are that vault's. The URL's wins, then the one this browser used last, then the server's own
       default — and the choice is written into the address and pinned, so every request from this tab
       names its vault whatever another tab or the terminal opens next. With none open there is no
       app to show: the picker is the page. */
    const vaults = (await loadVaults()) ?? [];
    id = settleVault(
      vaults.filter((v) => v.open).map((v) => v.id),
      vaults.find((v) => v.default)?.id ?? null,
    );
    if (id) await pull();
    /* The account's time zone is read before anything draws a time. */
    watchZone();
    /* Whether this install sends logs, asked once; the first page asks the person when nobody has
       answered (`telemetry/Prompt.tsx`). Not awaited: nothing on the page waits on it. */
    if (id) void startTelemetry();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Boundary>
        {account && !id ? (
          <Suspense fallback={null}>
            <NoVaultPage />
          </Suspense>
        ) : (
          <Gate initial={account} />
        )}
      </Boundary>
    </StrictMode>,
  );
}

void start();
