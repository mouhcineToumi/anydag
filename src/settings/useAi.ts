import { useMemo } from "react";

import { aiOn, AI_SWITCHES, type AiSwitch } from "./aiSwitch";
import { useSettings } from "./useSettings";

/**
 * Which AI features this page draws, re-rendered the moment a switch changes — here, in another
 * tab of this browser (`useSettings` hears the `storage` event), or by sync. A gesture that is not
 * React — a leader chord — reads `aiOn(readSettings(), …)` at the moment it runs instead.
 */
export function useAi(): Readonly<Record<AiSwitch, boolean>> {
  const { features } = useSettings();
  return useMemo(
    () => Object.fromEntries(AI_SWITCHES.map((f) => [f, aiOn({ features }, f)])) as Record<AiSwitch, boolean>,
    [features],
  );
}
