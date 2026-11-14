import { useEffect, type ComponentType } from "react";

import { watch } from "@/settings/sync";

import type { Account } from "./api";
import { AccountProvider } from "./useAuth";

/**
 * Loads the local user and mounts the app. There is no sign-in: the account is the server's fixed
 * local user, and a server that is not answering is the only way not to have one.
 *
 * `page` is the canvas (`App`) or, for `?view=1`, the read-only view (`ViewApp`), already imported
 * by `main.tsx` — each a chunk of its own, so "without the editor" is a fact about the network
 * rather than only about the tree: `useEditor`, the inspector, the library and the whole of
 * `src/edit/` are never fetched by a viewer. `test/view-graph.test.ts` holds the import graph to that.
 */
export function Gate({ initial, page: Page }: { initial: Account | null; page: ComponentType | null }) {
  useEffect(() => {
    if (!initial) return;
    return watch();
  }, [initial]);

  if (!initial || !Page) return <p role="alert">The AnyDag server is not answering.</p>;
  return (
    <AccountProvider value={initial}>
      <Page />
    </AccountProvider>
  );
}
