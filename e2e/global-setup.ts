import fs from "node:fs";
import path from "node:path";

import { ACCOUNT_FILE, AUTH_DIR, STATE_FILE } from "./boards";

/**
 * Get the suite ready, once, before any spec runs.
 *
 * `npm run dev` serves the vault `boards/local/` through `anydag serve`, and Vite's proxy carries
 * the token. So this only waits for the server and leaves a `storageState` holding the preferences
 * every context starts with.
 *
 * **A `globalSetup` rather than a setup *project***, and the reason is the visual baselines.
 * Playwright's snapshot path template carries `{-projectName}`, which is empty today because there
 * are no projects — so introducing one would rename all 45 committed screenshots.
 */

const ORIGIN = `http://localhost:${Number(process.env.ANYDAG_PORT) || 3500}`;

export default async function globalSetup(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) break;
    } catch {
      /* Not listening yet. */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  /* **The logs question is answered, no**, on the dev server's home, the first time the suite runs
     there: it is asked once per install, and a toast over every open file would take a click meant
     for the board. `telemetry.spec.ts` stands in its own answer with a route, so what this home
     says is never what it is testing. An answer somebody already gave is left. */
  try {
    const asked = (await (await fetch(`${ORIGIN}/api/telemetry`)).json()) as { consent: boolean | null };
    if (asked.consent === null) {
      await fetch(`${ORIGIN}/api/telemetry`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
    }
  } catch {
    /* A server too old to ask: there is no card to answer either. */
  }
  const account = { handle: "local", email: "" };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        cookies: [],
        /*
         * **The suite runs with preference sync off.**
         *
         * Eight otherwise-isolated workers share the vault the dev server opens, and they stopped
         * being isolated the moment a change to a preference is pushed to it: worker A opening
         * the library decided what worker B's next page load started with. Twenty checks failed
         * on it — a leader chord that toggled the library *closed* because it was already open,
         * an export taken at another check's scale, a board list that was open when the check
         * had just hidden it. A browser context otherwise gives that isolation for nothing.
         *
         * Seeded here rather than as a flag on two hundred URLs, and `storageState` is exactly the
         * mechanism for it. `settings.spec.ts` turns it back on for the one check that is *about*
         * the sync, separately from the rest.
         */
        origins: [
          {
            origin: ORIGIN,
            localStorage: [
              { name: "dag:sync", value: "off" },
              /* And the sidebar put away. It is open by default for a person, and a
                 column open by default would move the canvas under every check that measures
                 `.dag-viewport` or aims at a coordinate on it, for a reason none of them is about.
                 `sidebar.spec.ts` clears this for the checks that are about the sidebar, and
                 `e2e/sidebar.ts` docks it for the ones that need a row in it. Being a preference,
                 it would sync — which `dag:sync=off` above already stops. */
              { name: "dag:sidebar", value: "0" },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
  /* What `boards.ts` reads to know which board directory the fixtures go in — see the note there
     for why it is discovered rather than assumed. */
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({ handle: account.handle, email: account.email }, null, 2));
  fs.mkdirSync(path.join(AUTH_DIR, "..", "..", "boards", account.handle), { recursive: true });
}
