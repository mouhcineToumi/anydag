import { useEffect, useState } from "react";

import { desktop, type UpdateState } from "@/vault/desktop";
import { flushPending } from "./pendingWrites";

/**
 * The app's update state, for the sidebar's *Update* button and Settings → About. `null` where there
 * is no desktop bridge (`anydag serve`, `npm run dev`) — which is also how the button knows never to
 * show there — and until the shell has answered the first time.
 */
export function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const updates = desktop()?.updates;
    if (!updates) return;
    let live = true;
    const off = updates.onChange((next) => live && setState(next));
    void updates
      .state()
      // A change that arrived while this was in flight is newer than the answer.
      .then((first) => live && setState((now) => now ?? first))
      .catch(() => undefined);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/** Whether the *Update* button shows: an update is waiting, or exists and has to be fetched by hand. */
export const updateWaiting = (state: UpdateState | null): state is UpdateState & { version: string } =>
  state !== null && (state.status === "ready" || state.status === "manual") && state.version !== null;

/**
 * The button's action. Anything the page holds that is not on the disk is written first, and only
 * then does the shell stop the server and quit (or open the release page); the shell's own
 * `install` is what orders the rest.
 */
export async function installUpdate(): Promise<void> {
  const updates = desktop()?.updates;
  if (!updates) return;
  await flushPending();
  await updates.install();
}

/** *Check for updates*: the shell answers with the state the check ended in. */
export async function checkForUpdates(): Promise<void> {
  await desktop()?.updates?.check();
}
