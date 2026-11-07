import { lazy, Suspense, useEffect } from "react";

import { watch } from "@/settings/sync";
import { ViewApp } from "@/view/ViewApp";

import type { Account } from "./api";
import { AccountProvider } from "./useAuth";

/**
 * The canvas and everything that edits it, as a chunk of its own.
 *
 * `?view=1` draws a board or a note without it, and a lazy import is what makes "without the editor"
 * true of the network rather than only of the tree: `useEditor`, the inspector, the library and the
 * whole of `src/edit/` are never fetched by a viewer. `test/view-graph.test.ts` holds the import
 * graph to that.
 */
const App = lazy(() => import("@/App").then((m) => ({ default: m.App })));

/**
 * Loads the local user and mounts the app. There is no sign-in: the account is the server's fixed
 * local user, and a server that is not answering is the only way not to have one.
 */
export function Gate({ initial }: { initial: Account | null }) {
  useEffect(() => {
    if (!initial) return;
    return watch();
  }, [initial]);

  if (!initial) return <p role="alert">The AnyDag server is not answering.</p>;
  const viewing = new URLSearchParams(location.search).get("view") === "1";
  return (
    <AccountProvider value={initial}>
      {viewing ? (
        <ViewApp />
      ) : (
        <Suspense fallback={null}>
          <App />
        </Suspense>
      )}
    </AccountProvider>
  );
}
