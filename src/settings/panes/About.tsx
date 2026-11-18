import { AlertCircle, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/ui/controls";
import { Dialog } from "@/ui/Dialog";
import { checkForUpdates, chooseUpdateChannel, downgradeTo, useUpdates } from "@/ui/updates";
import type { UpdateChannel, UpdateState } from "@/vault/desktop";
import { markSaved } from "../saved";
import { Fact, Facts, Field, Group, ICON, useHealth } from "./common";

/** The product version this page was built from: the repository's `VERSION`, put in by `vite.config.ts`. */
const BUILT = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

/** The channels a person may choose, in the order of how settled they are. */
const CHANNELS: readonly { value: UpdateChannel; label: string }[] = [
  { value: "latest", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "nightly", label: "Nightly" },
];

/** A channel's name as the person reads it; a word the app does not offer is shown as it is. */
const channelName = (word: string): string => CHANNELS.find((c) => c.value === word)?.label ?? word;

/** The words a downgrade is offered with, in the status and again in the confirmation. */
const downgradeLine = (u: UpdateState): string =>
  `You are on ${u.current}; the newest ${channelName(u.channel).toLowerCase()} is ${u.version}. Installing it is a downgrade.`;

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
    case "downgrade":
      return downgradeLine(u);
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
  const idle = updates.status === "idle" || updates.status === "error" || updates.status === "downgrade";
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <>
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
        {updates.status === "downgrade" && updates.version ? (
          <Fact label="Go back">
            <Button data-dag-setting-update-downgrade={updates.version} onClick={() => setAsking(updates.version)}>
              Install {updates.version}…
            </Button>
          </Fact>
        ) : null}
        <Fact label="Check now">
          <Button disabled={!idle} data-dag-setting-update-check="" onClick={() => void checkForUpdates()}>
            Check for updates
          </Button>
        </Fact>
      </Facts>
      <ChannelChoice updates={updates} />
      {asking !== null && updates.status === "downgrade" && updates.version === asking ? (
        <Dialog
          role="alertdialog"
          aria-label="Install an older version"
          className="dag-settings dag-purge"
          scrim={{ "data-dag-update-downgrade-ask": asking }}
          onClose={() => setAsking(null)}
        >
          <div className="dag-settings__head">
            <AlertCircle {...ICON} className="dag-purge__mark" aria-hidden="true" />
            <h2>Install version {asking}?</h2>
          </div>
          <p className="dag-purge__what">{downgradeLine(updates)}</p>
          <p className="dag-purge__what">
            It is downloaded now and installed like any update: Update in the sidebar restarts into it. A build that cannot
            install updates itself opens the release page instead.
          </p>
          <div className="dag-settings__foot dag-purge__foot">
            <Button onClick={() => setAsking(null)}>Cancel</Button>
            <Button
              variant="primary"
              data-dag-update-downgrade-confirm=""
              autoFocus
              onClick={() => {
                const version = asking;
                setAsking(null);
                void downgradeTo(version);
              }}
            >
              Install {asking}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * The update channel (#525): which releases this app updates to. A preference of this machine, kept
 * by the shell — not the vault's, and never synced. The default is the version's own.
 */
function ChannelChoice({ updates }: { updates: UpdateState }) {
  /* The shell answers with the new state; until then the select shows what was chosen. */
  const [pending, setPending] = useState<string | null>(null);
  const value = pending ?? updates.channel;
  const offered = CHANNELS.some((c) => c.value === value);
  return (
    <Group>
      <Field
        label="Update channel"
        hint={`This version's own is ${channelName(updates.versionChannel)}. A change applies at the next check; going back to a steadier channel asks before it installs an older version.`}
        save="update-channel"
      >
        <select
          className="dag-select"
          data-dag-setting-update-channel=""
          aria-label="Update channel"
          value={value}
          onChange={(e) => {
            const next = e.target.value as UpdateChannel;
            setPending(next);
            void chooseUpdateChannel(next).finally(() => {
              setPending(null);
              markSaved("update-channel");
            });
          }}
        >
          {offered ? null : <option value={value}>{channelName(value)}</option>}
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
    </Group>
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
