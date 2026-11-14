import { ChevronRight } from "lucide-react";

import { Button } from "@/ui/controls";
import { checkForUpdates, useUpdates } from "@/ui/updates";
import type { UpdateState } from "@/vault/desktop";
import { Fact, Facts, Group, useHealth } from "./common";

/** The product version this page was built from: the repository's `VERSION`, put in by `vite.config.ts`. */
const BUILT = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

/** What the check has found, in a sentence. The button in the sidebar's foot is where it is acted on. */
function updateLine(u: UpdateState): string {
  switch (u.status) {
    case "idle":
      return u.checkedAt === null ? "Not checked yet" : "You are on the latest version";
    case "checking":
      return "Checking…";
    case "downloading":
      return `Downloading version ${u.version}${u.percent === null ? "" : ` (${u.percent}%)`}`;
    case "ready":
      return `Version ${u.version} is ready. Use Update in the sidebar to restart into it.`;
    case "manual":
      return `Version ${u.version} is out. This build cannot install it itself: use Download update in the sidebar.`;
    case "error":
      return "The last check failed";
    default:
      return assertNever(u.status);
  }
}

function assertNever(x: never): never {
  throw new Error(`unhandled update status ${String(x)}`);
}

/** Desktop only: the answer the app has about its own updates, and a way to ask again. */
function UpdatesFacts({ updates }: { updates: UpdateState }) {
  const idle = updates.status === "idle" || updates.status === "error";
  return (
    <Facts title="Updates">
      <Fact label="Status">
        <span className="dag-settings__value" data-dag-setting-update={updates.status}>
          {updateLine(updates)}
        </span>
      </Fact>
      {updates.checkedAt !== null ? (
        <Fact label="Last checked">
          <span className="dag-settings__value" data-dag-setting-update-checked="">
            {new Date(updates.checkedAt).toLocaleString()}
          </span>
        </Fact>
      ) : null}
      {updates.error ? (
        <p className="dag-settings__problem" role="alert" data-dag-setting-update-error="">
          {updates.error}
        </p>
      ) : null}
      <Fact label="Check now">
        <Button disabled={!idle} data-dag-setting-update-check="" onClick={() => void checkForUpdates()}>
          Check for updates
        </Button>
      </Fact>
    </Facts>
  );
}

/** What this is: the versions, said as facts rather than settings, and the way to the shortcuts. */
export function AboutPane({ onShortcuts }: { onShortcuts(): void }) {
  const health = useHealth();
  const updates = useUpdates();
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
      {updates?.enabled ? <UpdatesFacts updates={updates} /> : null}
      <Group>
        <button type="button" className="dag-settings__link" onClick={onShortcuts}>
          <span>Keyboard shortcuts</span>
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </Group>
    </>
  );
}
