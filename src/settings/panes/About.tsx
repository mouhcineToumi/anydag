import { ChevronRight } from "lucide-react";

import { Fact, Facts, Group, useHealth } from "./common";

/** The product version this page was built from: the repository's `VERSION`, put in by `vite.config.ts`. */
const BUILT = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

/** What this is: the versions, said as facts rather than settings, and the way to the shortcuts. */
export function AboutPane({ onShortcuts }: { onShortcuts(): void }) {
  const health = useHealth();
  return (
    <>
      <Facts title="Version">
        <Fact label="AnyDag">
          <span className="dag-settings__value" data-dag-setting-version="">
            {BUILT}
          </span>
        </Fact>
        <Fact label="Server">
          <span className="dag-settings__value" data-dag-setting-server="">
            {health ? health.version : "Not answering"}
          </span>
        </Fact>
      </Facts>
      <Group>
        <button type="button" className="dag-settings__link" onClick={onShortcuts}>
          <span>Keyboard shortcuts</span>
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </Group>
    </>
  );
}
