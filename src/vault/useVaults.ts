import { useSyncExternalStore } from "react";

import { homeNow, subscribeVaults, vaultsNow, type Vault } from "./api";

/** The recent vaults, newest first — `null` until the first answer. */
export function useVaults(): Vault[] | null {
  return useSyncExternalStore(subscribeVaults, vaultsNow, () => null);
}

/** The home folder the server is on, for a new vault's default parent. */
export function useHome(): string {
  return useSyncExternalStore(subscribeVaults, homeNow, () => "");
}
