import { useTheme } from "@/theme/useTheme";

import { NoVault } from "./Welcome";

/** {@link NoVault} on a page of its own, in the theme the person last chose (the app is not mounted to apply one). */
export function NoVaultPage() {
  useTheme();
  return <NoVault />;
}
