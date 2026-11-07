import { ChevronRight } from "lucide-react";

import { Field, Group, useHealth } from "./common";

/** The product version this page was built from: the repository's `VERSION`, put in by `vite.config.ts`. */
const BUILT = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

/** What this is: the version, the server, and the way to the shortcuts. */
export function AboutPane({ onShortcuts }: { onShortcuts(): void }) {
  const health = useHealth();
  return (
    <>
      <Group>
        <Field label="AnyDag" plain>
          <span className="dag-settings__value" data-dag-setting-version="">
            {BUILT}
          </span>
        </Field>
        <Field label="Server" plain>
          <span className="dag-settings__value" data-dag-setting-server="">
            {health ? health.version : "Not answering"}
          </span>
        </Field>
      </Group>
      <Group>
        <button type="button" className="dag-settings__link" onClick={onShortcuts}>
          <span>Keyboard shortcuts</span>
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </Group>
    </>
  );
}
