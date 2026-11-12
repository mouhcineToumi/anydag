import { Check as CheckIcon, Copy, Link2Off, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Check, TextField } from "@/ui/controls";
import { copyText } from "@/ui/clipboard";
import { SyncError, syncDevices, syncLink, syncNow, syncPair, syncRemotes, syncRevoke, syncUnlink } from "@/sync/api";
import { hrefForPath, passphraseProblem, plural, sameRecovery, statusWords } from "@/sync/status";
import type { SyncDevices, SyncRemote, SyncStatus } from "@/sync/types";
import { adoptSyncStatus, useSyncStatus } from "@/sync/useSyncStatus";
import { withVault } from "@/vault/current";
import { refuseLocked, useLocked } from "../lock";

import { Fact, Facts, Field, Group, Hint, ICON } from "./common";

const say = (e: unknown): string => (e instanceof SyncError ? e.message : "It could not be done. Try again.");

/** One in-row question: the button, then "Sure?" with the answer beside it. */
function Confirm({
  label,
  question,
  hook,
  disabled,
  onYes,
  children,
}: {
  label: ReactNode;
  question: string;
  hook: string;
  disabled?: boolean;
  onYes(): void;
  children?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="dag-button" disabled={disabled} {...{ [hook]: "" }} onClick={() => setAsking(true)}>
        {children}
        <span>{label}</span>
      </button>
    );
  }
  return (
    <span className="dag-sync__confirm" {...{ [`${hook}-confirm`]: "" }}>
      <span className="dag-settings__desc">{question}</span>
      <button
        type="button"
        className="dag-button"
        {...{ [`${hook}-yes`]: "" }}
        onClick={() => {
          setAsking(false);
          onYes();
        }}
      >
        Yes
      </button>
      <button type="button" className="dag-button" {...{ [`${hook}-no`]: "" }} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="dag-settings__problem" role="alert" data-dag-sync-problem="">
      {text}
    </p>
  ) : null;
}

/**
 * Sync: pair this device with a server, link the vault to a remote, and
 * watch it. Every call is `/api/sync/*`; nothing here knows what a change is. **Locked, nothing that
 * pairs, links, unlinks or revokes is offered** — Sync now only reads, so it stays.
 */
export function SyncPane() {
  const status = useSyncStatus();
  const locked = useLocked();
  /* Held here, above the linked/unlinked split: an upload links the vault the moment it answers, and
     the recovery code — shown once, kept nowhere — would go with the form that was showing it. */
  const [recovery, setRecovery] = useState<string | null>(null);
  if (!status) return <Hint data-dag-sync-loading="">Looking…</Hint>;
  if (recovery !== null) return <Recovery code={recovery} onDone={() => setRecovery(null)} />;
  if (status.linked) return <Linked status={status} locked={locked} />;
  return <Link status={status} locked={locked} onRecovery={setRecovery} />;
}

// -- not linked ----------------------------------------------------------------------------------

function Link({ status, locked, onRecovery }: { status: SyncStatus; locked: boolean; onRecovery(code: string): void }) {
  const [paired, setPaired] = useState(status.server !== null);
  return (
    <>
      <Group title="Server">
        <PairForm status={status} locked={locked} paired={paired} onPaired={() => setPaired(true)} />
      </Group>
      {paired ? (
        <Choices locked={locked} onRecovery={onRecovery} />
      ) : (
        <Hint data-dag-sync-intro="">
          Sync keeps this vault on your other devices. Pair this device with a sync server to begin.
        </Hint>
      )}
    </>
  );
}

function PairForm({
  status,
  locked,
  paired,
  onPaired,
}: {
  status: SyncStatus;
  locked: boolean;
  paired: boolean;
  onPaired(): void;
}) {
  const [server, setServer] = useState(status.server ?? "");
  const [code, setCode] = useState("");
  const [device, setDevice] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (paired && status.server) {
    return (
      <Facts title="Server">
        <Fact label="Paired with">
          <span className="dag-settings__value" data-dag-sync-server="">
            {status.server}
          </span>
        </Fact>
      </Facts>
    );
  }
  const go = async () => {
    if (locked) return void refuseLocked();
    setBusy(true);
    setProblem(null);
    try {
      await syncPair({ server: server.trim(), code: code.trim(), ...(device.trim() ? { device: device.trim() } : {}) });
      onPaired();
      setCode("");
    } catch (e) {
      setProblem(say(e));
    }
    setBusy(false);
  };
  return (
    <>
      <Field label="Server address" hint="Where the sync server is, such as https://sync.example.com." plain>
        <TextField
          wide
          data-dag-sync-server-input=""
          spellCheck={false}
          autoComplete="off"
          value={server}
          onChange={(e) => setServer(e.target.value)}
        />
      </Field>
      <Field label="One-time code" hint="From the server's admin, good for one pairing." plain>
        <TextField
          wide
          data-dag-sync-code=""
          spellCheck={false}
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Field label="This device's name" hint="Optional. Shown in the device list." plain>
        <TextField
          wide
          data-dag-sync-device-input=""
          autoComplete="off"
          value={device}
          onChange={(e) => setDevice(e.target.value)}
        />
      </Field>
      <Field label="Pair" plain>
        <button
          type="button"
          className="dag-button"
          data-dag-sync-pair=""
          disabled={busy || !server.trim() || !code.trim()}
          onClick={() => void go()}
        >
          <ShieldCheck {...ICON} aria-hidden="true" />
          <span>{busy ? "Pairing…" : "Pair this device"}</span>
        </button>
      </Field>
      <Problem text={problem} />
    </>
  );
}

type Mode = "upload" | "download" | "merge";

function Choices({ locked, onRecovery }: { locked: boolean; onRecovery(code: string): void }) {
  const [remotes, setRemotes] = useState<SyncRemote[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    syncRemotes().then(
      (r) => setRemotes(r.remotes),
      (e) => setProblem(say(e)),
    );
  }, []);

  return (
    <>
      <Group title="Link this vault">
        <Field
          label="Upload this vault"
          hint="Make a new remote from the files here. You choose a passphrase and get a recovery code."
          plain
        >
          <button
            type="button"
            className="dag-button"
            data-dag-sync-choose="upload"
            disabled={locked}
            onClick={() => setMode(mode === "upload" ? null : "upload")}
          >
            Upload…
          </button>
        </Field>
        {mode === "upload" ? <UploadForm onRecovery={onRecovery} /> : null}
        <Field label="Download into this vault" hint="Needs an empty vault. Opens as a new vault with the remote's files." plain>
          <button
            type="button"
            className="dag-button"
            data-dag-sync-choose="download"
            disabled={locked || !remotes?.length}
            onClick={() => setMode(mode === "download" ? null : "download")}
          >
            Download…
          </button>
        </Field>
        {mode === "download" && remotes ? <JoinForm mode="download" remotes={remotes} /> : null}
        <Field
          label="Merge"
          hint="Join a vault that already has files to a remote. Files that differ become conflict copies."
          plain
        >
          <button
            type="button"
            className="dag-button"
            data-dag-sync-choose="merge"
            disabled={locked || !remotes?.length}
            onClick={() => setMode(mode === "merge" ? null : "merge")}
          >
            Merge…
          </button>
        </Field>
        {mode === "merge" && remotes ? <JoinForm mode="merge" remotes={remotes} /> : null}
      </Group>
      <Problem text={problem} />
    </>
  );
}

function UploadForm({ onRecovery }: { onRecovery(code: string): void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const bad = passphraseProblem(a, b);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const got = await syncLink({ mode: "upload", passphrase: a });
      adoptSyncStatus(got.status);
      onRecovery(got.recovery ?? "");
    } catch (e) {
      setProblem(say(e));
    }
    setBusy(false);
  };
  return (
    <>
      <Field label="Passphrase" hint="Encrypts the vault's key. The server never sees it. At least 8 characters." plain>
        <TextField
          wide
          type="password"
          data-dag-sync-pass=""
          autoComplete="new-password"
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
      </Field>
      <Field label="Again" plain>
        <TextField
          wide
          type="password"
          data-dag-sync-pass-again=""
          autoComplete="new-password"
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
      </Field>
      <Field label="Upload" hint={a && b ? (bad ?? undefined) : undefined} plain>
        <button
          type="button"
          className="dag-button"
          data-dag-sync-upload=""
          disabled={busy || bad !== null}
          onClick={() => void go()}
        >
          {busy ? "Uploading…" : "Upload this vault"}
        </button>
      </Field>
      <Problem text={problem} />
    </>
  );
}

function JoinForm({ mode, remotes }: { mode: "download" | "merge"; remotes: SyncRemote[] }) {
  const [remote, setRemote] = useState(remotes[0]?.id ?? "");
  const [useRecovery, setUseRecovery] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const got = await syncLink({ mode, remote, ...(useRecovery ? { recovery: secret.trim() } : { passphrase: secret }) });
      adoptSyncStatus(got.status);
      /* A download re-keys the vault: the page reloads onto the id it has now. */
      if (mode === "download") location.assign(`/?vault=${encodeURIComponent(got.vault)}`);
    } catch (e) {
      setProblem(say(e));
    }
    setBusy(false);
  };
  return (
    <>
      {mode === "merge" ? (
        <Hint data-dag-sync-merge-warning="">
          Files that differ here and on the remote are kept both ways, one as a conflict copy.
        </Hint>
      ) : null}
      <Field label="Remote" plain>
        <select className="dag-select" data-dag-sync-remote="" value={remote} onChange={(e) => setRemote(e.target.value)}>
          {remotes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
              {r.mine ? " (this vault)" : ""} · {plural(r.seq, "change")}
            </option>
          ))}
        </select>
      </Field>
      <Field label={useRecovery ? "Recovery code" : "Passphrase"} plain>
        <TextField
          wide
          type={useRecovery ? "text" : "password"}
          data-dag-sync-secret=""
          spellCheck={false}
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </Field>
      <Field label="Use the recovery code instead" plain>
        <Check
          data-dag-sync-use-recovery=""
          checked={useRecovery}
          onChange={(e) => (setUseRecovery(e.target.checked), setSecret(""))}
        />
      </Field>
      <Field label={mode === "download" ? "Download" : "Merge"} plain>
        <button
          type="button"
          className="dag-button"
          data-dag-sync-join={mode}
          disabled={busy || !remote || !secret}
          onClick={() => void go()}
        >
          {busy ? "Working…" : mode === "download" ? "Download into this vault" : "Merge onto the remote"}
        </button>
      </Field>
      <Problem text={problem} />
    </>
  );
}

/** The recovery code, once. It is asked back typed before this closes, and kept nowhere. */
function Recovery({ code, onDone }: { code: string; onDone(): void }) {
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const ok = saved && sameRecovery(typed, code);
  return (
    <Group title="Your recovery code">
      <Hint data-dag-sync-recovery-note="">
        This opens the vault if the passphrase is forgotten. It is shown once and kept nowhere. Save it somewhere safe.
      </Hint>
      <Field label="Recovery code" plain stack>
        <span className="dag-sync__code">
          <code data-dag-sync-recovery="">{code}</code>
          <button
            type="button"
            className="dag-button"
            data-dag-sync-recovery-copy=""
            onClick={() => void copyText(code).then(() => setCopied(true))}
          >
            {copied ? <CheckIcon {...ICON} aria-hidden="true" /> : <Copy {...ICON} aria-hidden="true" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </span>
      </Field>
      <Field label="I have saved it">
        <Check data-dag-sync-recovery-saved="" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      </Field>
      <Field label="Type it back" hint="Spaces, dashes and case do not matter." plain>
        <TextField
          wide
          data-dag-sync-recovery-typed=""
          spellCheck={false}
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <Field label="Done" plain>
        <button
          type="button"
          className="dag-button"
          data-dag-sync-recovery-done=""
          disabled={!ok}
          onClick={(e) => {
            /* This button goes with the view it closes, and the focus would fall to <body>, where
               the modal's own key handler never hears Escape: hand it back to the dialog. */
            const dialog = e.currentTarget.closest<HTMLElement>("[role='dialog']");
            onDone();
            requestAnimationFrame(() => dialog?.focus());
          }}
        >
          Close
        </button>
      </Field>
    </Group>
  );
}

// -- linked --------------------------------------------------------------------------------------

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function Linked({ status, locked }: { status: SyncStatus; locked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const now = async () => {
    setBusy(true);
    setProblem(null);
    try {
      adoptSyncStatus(await syncNow());
    } catch (e) {
      setProblem(say(e));
    }
    setBusy(false);
  };
  const unlink = async () => {
    if (locked) return void refuseLocked();
    try {
      adoptSyncStatus(await syncUnlink());
    } catch (e) {
      setProblem(say(e));
    }
  };

  return (
    <>
      <Facts title="Status">
        <Fact label="State">
          <span className="dag-settings__value" data-dag-sync-state={status.state}>
            {statusWords(status)}
          </span>
        </Fact>
        <Fact label="Last synced">
          <span className="dag-settings__value" data-dag-sync-last="">
            {when(status.last)}
          </span>
        </Fact>
        <Fact label="Waiting here">
          <span className="dag-settings__value" data-dag-sync-pending={status.pending}>
            {plural(status.pending, "change")}
          </span>
        </Fact>
        <Fact label="Server">
          <span className="dag-settings__value" data-dag-sync-server="">
            {status.server}
          </span>
        </Fact>
        <Fact label="Sync now">
          <button
            type="button"
            className="dag-button"
            data-dag-sync-now=""
            disabled={busy || status.state === "syncing"}
            onClick={() => void now()}
          >
            <RefreshCw {...ICON} aria-hidden="true" />
            <span>{busy ? "Syncing…" : "Sync now"}</span>
          </button>
        </Fact>
      </Facts>
      <Problem text={problem} />

      {status.conflicts.length > 0 ? (
        <Group title="Conflict copies">
          <Hint data-dag-sync-conflicts-note="">
            Two devices changed these at once. Open each, keep what you want, and delete the copy.
          </Hint>
          <ul className="dag-sync__conflicts" data-dag-sync-conflicts="">
            {status.conflicts.map((rel) => (
              <li key={rel}>
                <a href={withVault(hrefForPath(rel))} data-dag-sync-conflict={rel}>
                  {rel}
                </a>
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      <Devices locked={locked} />

      <Group title="Unlink">
        <Field label="Unlink this vault" hint="Stops syncing here. The files here and the remote are kept." plain>
          <Confirm
            label="Unlink"
            question="Stop syncing this vault?"
            hook="data-dag-sync-unlink"
            disabled={locked}
            onYes={() => void unlink()}
          >
            <Link2Off {...ICON} aria-hidden="true" />
          </Confirm>
        </Field>
      </Group>
    </>
  );
}

function Devices({ locked }: { locked: boolean }) {
  const [list, setList] = useState<SyncDevices["devices"] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    syncDevices().then(
      (d) => setList(d.devices),
      (e) => setProblem(say(e)),
    );
  }, []);
  const revoke = useCallback(
    async (id: string) => {
      if (locked) return void refuseLocked();
      try {
        setList((await syncRevoke(id)).devices);
      } catch (e) {
        setProblem(say(e));
      }
    },
    [locked],
  );
  return (
    <Group title="Devices">
      {(list ?? []).map((d) => (
        <Field
          key={d.id}
          label={
            <>
              {d.name}
              {d.me ? (
                <em className="dag-sync__me" data-dag-sync-me="">
                  {" "}
                  (this device)
                </em>
              ) : null}
            </>
          }
          hint={`${d.platform} · seen ${when(d.seen)}${d.revoked ? " · revoked" : ""}`}
          plain
          data-dag-sync-device={d.id}
        >
          {!d.me && !d.revoked ? (
            <Confirm
              label="Revoke"
              question="Revoke this device?"
              hook="data-dag-sync-revoke"
              disabled={locked}
              onYes={() => void revoke(d.id)}
            />
          ) : null}
        </Field>
      ))}
      {list === null && !problem ? <Hint>Looking…</Hint> : null}
      <Problem text={problem} />
    </Group>
  );
}
