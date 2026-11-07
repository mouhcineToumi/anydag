import { createContext, useContext } from "react";

import type { Account } from "./api";

/** The local user, for the parts of the app that show it. */
const AccountContext = createContext<Account | null>(null);

export const AccountProvider = AccountContext.Provider;

export function useAccount(): Account | null {
  return useContext(AccountContext);
}
