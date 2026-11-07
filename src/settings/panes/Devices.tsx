import { Check as CheckIcon, Copy, QrCode } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { encode } from "uqr";

import { THEMES, paperTheme } from "@/theme/useTheme";
import { Switch, TextField } from "@/ui/controls";
import { refuseLocked, useLocked } from "../lock";

import { Field, Group, Hint, ICON, copyText } from "./common";

/**
 * Remote access: a phone reaching this desktop (`server/remote.ts`, `docs/remote-access.md`).
 *
 * Two panes in one, by which door the page came through. On the desktop it is the door — on or off,
 * the address a phone opens, whether Tailscale passes that address on — a pairing code drawn as a QR
 * code, and the paired devices. On a phone every `/api/remote` route is refused (`local-only`), so it
 * is the device itself: which one this is, and *Forget this device*.
 *
 * The person's, in every vault: the door is the app's, not a vault's, so the tab is in the app's group.
 */

interface RemoteStatus {
  enabled: boolean;
  port: number;
  url: string | null;
  listening: boolean;
  problem: string | null;
}

interface TailscaleState {
  installed: boolean;
  running: boolean;
  address: string | null;
  serving: boolean | null;
}

interface Device {
  id: string;
  name: string;
  created: string;
  seen: string;
}

interface PairCode {
  code: string;
  expires: string;
  link: string | null;
}

class Refused extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "PUT", route: string, body?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(route, {
      method,
      ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw new Refused("The desktop did not answer. Try again.", null, 0);
  }
  const got = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new Refused(got.error ?? "It could not be done. Try again.", got.code ?? null, r.status);
  return got as T;
}

const say = (e: unknown): string => (e instanceof Refused ? e.message : "It could not be done. Try again.");

/** How often the tab asks again while it is open: a door opening, a phone pairing, Tailscale connecting. */
const POLL_MS = 3_000;

/** Which door this page came through: the desktop's own, or a paired phone's. */
type Door = { kind: "asking" } | { kind: "desktop"; status: RemoteStatus } | { kind: "phone"; device: Device } | { kind: "down" };

export function DevicesPane() {
  const [door, setDoor] = useState<Door>({ kind: "asking" });

  const ask = useCallback(async () => {
    try {
      /* `null` on the desktop's own door; a phone's device on the remote one — asked first, because
         every `/api/remote` route is a 403 from a phone, and a 4xx is a console error. */
      const { device } = await call<{ device: Device | null }>("GET", "/api/device");
      if (device) return setDoor({ kind: "phone", device });
      setDoor({ kind: "desktop", status: await call<RemoteStatus>("GET", "/api/remote") });
    } catch {
      setDoor({ kind: "down" });
    }
  }, []);

  useEffect(() => {
    void ask();
  }, [ask]);

  if (door.kind === "asking") return <Hint>Asking the desktop…</Hint>;
  if (door.kind === "down") return <Hint data-dag-remote-down="">The desktop did not answer. Close Settings and open it again.</Hint>;
  if (door.kind === "phone") return <ThisDevice device={door.device} />;
  return <Desktop first={door.status} />;
}

/* ---------------------------------------------------------------- the desktop */

function Desktop({ first }: { first: RemoteStatus }) {
  const locked = useLocked();
  const [status, setStatus] = useState(first);
  const [tailscale, setTailscale] = useState<TailscaleState | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, t, d] = await Promise.all([
      call<RemoteStatus>("GET", "/api/remote").catch(() => null),
      call<TailscaleState>("GET", "/api/remote/tailscale").catch(() => null),
      call<{ devices: Device[] }>("GET", "/api/remote/devices").catch(() => null),
    ]);
    if (s) setStatus(s);
    if (t) setTailscale(t);
    if (d) setDevices(d.devices);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const configure = async (patch: { enabled?: boolean; url?: string }): Promise<RemoteStatus | null> => {
    if (locked) return refuseLocked(), null;
    setProblem(null);
    setBusy(true);
    try {
      const s = await call<RemoteStatus>("PUT", "/api/remote", patch);
      setStatus(s);
      return s;
    } catch (e) {
      setProblem(say(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const turn = async (on: boolean) => {
    const s = await configure({ enabled: on });
    /* No address yet and Tailscale knows this machine's: that is the address, as `anydag remote on` takes it. */
    if (s?.enabled && !s.url && tailscale?.address) await configure({ url: tailscale.address });
    void refresh();
  };

  const serve = async () => {
    if (locked) return void refuseLocked();
    setProblem(null);
    setBusy(true);
    try {
      const got = await call<{ ok: boolean; message: string }>("POST", "/api/remote/tailscale/serve");
      if (!got.ok) setProblem(got.message || "Tailscale did not serve the door.");
    } catch (e) {
      setProblem(say(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const state = !status.enabled ? "Off" : status.listening ? "On" : status.problem ? `Not answering: ${status.problem}` : "Opening…";

  return (
    <>
      <Group title="Remote access">
        <Field label="Let paired phones reach this desktop" hint="Everything still runs here. A phone opens this app over Tailscale, and only while this app is open.">
          <Switch data-dag-setting-remote="" checked={status.enabled} disabled={busy || locked} onChange={(e) => void turn(e.target.checked)} />
        </Field>
        <Field label="State" plain data-dag-remote-state="">
          <span className="dag-settings__value">{state}</span>
        </Field>
        <Address status={status} tailscale={tailscale} disabled={busy || locked} onSave={(url) => void configure({ url })} />
        <Field label="Tailscale" plain hint={tailscaleHint(tailscale, status.port)} data-dag-remote-tailscale="">
          {tailscale?.running && tailscale.serving === false ? (
            <button type="button" className="dag-button" data-dag-remote-serve="" disabled={busy || locked} onClick={() => void serve()}>
              Serve with Tailscale
            </button>
          ) : (
            <span className="dag-settings__value">{tailscaleWord(tailscale)}</span>
          )}
        </Field>
      </Group>
      {problem ? (
        <p className="dag-settings__problem" role="alert" data-dag-remote-problem="">
          {problem}
        </p>
      ) : null}

      <Group title="Pair a phone">
        <Pair status={status} locked={locked} onPaired={() => void refresh()} />
      </Group>

      <Group title="Paired devices">
        <Devices devices={devices} locked={locked} onRevoked={() => void refresh()} />
      </Group>
    </>
  );
}

function tailscaleWord(t: TailscaleState | null): string {
  if (!t) return "…";
  if (!t.installed) return "Not installed";
  if (!t.running) return "Not connected";
  return t.serving ? "Serving the door" : "Connected";
}

function tailscaleHint(t: TailscaleState | null, port: number): ReactNode {
  if (!t) return null;
  if (!t.installed)
    return (
      <>
        Install Tailscale on this computer and on the phone, signed in to one account:{" "}
        <a className="dag-remote__inline" href="https://tailscale.com/download" target="_blank" rel="noreferrer">
          tailscale.com/download
        </a>
      </>
    );
  if (!t.running) return "Open Tailscale and sign in, on this computer and on the phone.";
  if (t.serving) return `${t.address} reaches this app.`;
  return `This passes ${t.address} to the door on port ${port}, with Tailscale's certificate.`;
}

/** The address a phone opens: typed, or this machine's on its tailnet. Saved on Enter or on leaving the box. */
function Address({ status, tailscale, disabled, onSave }: { status: RemoteStatus; tailscale: TailscaleState | null; disabled: boolean; onSave(url: string): void }) {
  const [typed, setTyped] = useState(status.url ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setTyped(status.url ?? "");
  }, [status.url, focused]);

  const offer = tailscale?.address && tailscale.address !== status.url ? tailscale.address : null;
  const save = () => {
    const url = typed.trim();
    if (url !== (status.url ?? "")) onSave(url);
  };

  return (
    <Field
      label="Address"
      stack
      plain
      hint={
        offer ? (
          <>
            This computer on Tailscale is{" "}
            <button type="button" className="dag-remote__inline" data-dag-remote-use-tailscale="" disabled={disabled} onClick={() => onSave(offer)}>
              {offer}
            </button>
          </>
        ) : (
          "What a phone opens. The pairing code leads there."
        )
      }
    >
      <TextField
        wide
        data-dag-remote-url=""
        placeholder="https://<this computer>.<tailnet>.ts.net"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        value={typed}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          save();
        }}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape" && typed !== (status.url ?? "")) {
            e.stopPropagation();
            setTyped(status.url ?? "");
          }
        }}
      />
    </Field>
  );
}

/** A one-time code: drawn as a QR code the phone's camera opens, with the link beside it, for five minutes. */
function Pair({ status, locked, onPaired }: { status: RemoteStatus; locked: boolean; onPaired(): void }) {
  const [code, setCode] = useState<PairCode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const left = code ? Math.max(0, Date.parse(code.expires) - now) : 0;

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [code]);

  /* The code is spent or gone: a device appearing is the sign it was used. Ask once more and let it go. */
  useEffect(() => {
    if (code && left === 0) {
      setCode(null);
      onPaired();
    }
  }, [code, left, onPaired]);

  /* Turning the door off burns the code on the server; the picture goes with it. */
  useEffect(() => {
    if (!status.enabled) setCode(null);
  }, [status.enabled]);

  const make = async () => {
    if (locked) return void refuseLocked();
    setProblem(null);
    try {
      const got = await call<PairCode>("POST", "/api/remote/pair");
      setNow(Date.now());
      setCode(got);
    } catch (e) {
      setProblem(say(e));
    }
  };

  if (!status.enabled) return <Field label="Turn remote access on to pair a phone" plain />;
  if (!status.url) return <Field label="Set the address first" hint="The code is a link to it." plain />;

  return (
    <>
      {code?.link ? (
        <div className="dag-remote__pair" data-dag-remote-pair="">
          <QrImage text={code.link} />
          <div className="dag-remote__pair-text">
            <span className="dag-settings__name">Scan this with the phone's camera</span>
            <span className="dag-settings__desc">
              It works once, for {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1_000)).padStart(2, "0")} more. The phone needs Tailscale on, signed in to the same account.
            </span>
            <code className="dag-remote__link" data-dag-remote-link="">
              {code.link}
            </code>
            <span className="dag-settings__actions">
              <button
                type="button"
                className="dag-button"
                data-dag-remote-copy=""
                onClick={() => void copyText(code.link!).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1_500)))}
              >
                {copied ? <CheckIcon {...ICON} aria-hidden="true" /> : <Copy {...ICON} aria-hidden="true" />}
                <span>{copied ? "Copied" : "Copy link"}</span>
              </button>
              <button type="button" className="dag-button" data-dag-remote-new-code="" disabled={locked} onClick={() => void make()}>
                New code
              </button>
            </span>
          </div>
        </div>
      ) : (
        <Field label="Show a pairing code" hint="A QR code for the phone to scan. It admits one device, and only for five minutes." plain>
          <button type="button" className="dag-button" data-dag-remote-show-code="" disabled={locked} onClick={() => void make()}>
            <QrCode {...ICON} aria-hidden="true" />
            <span>Show code</span>
          </button>
        </Field>
      )}
      {problem ? (
        <p className="dag-settings__problem" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

/**
 * The QR code, drawn here from the link with nothing sent anywhere. Dark on light in every theme —
 * a camera reads an inverted code badly — so the two colours are a light theme's own ink and paper,
 * never the screen's, and never a literal.
 */
function QrImage({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { size: qr.size, path: d };
  }, [text]);
  const light = paperTheme(THEMES.paper ?? Object.values(THEMES)[0]!).color;
  return (
    <svg className="dag-remote__qr" data-dag-remote-qr="" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Pairing code" shapeRendering="crispEdges">
      <rect width={size} height={size} fill={light.paper} />
      <path d={path} fill={light.ink} />
    </svg>
  );
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const ago = Date.now() - t;
  if (ago < 2 * 60_000) return "just now";
  if (ago < 60 * 60_000) return `${Math.round(ago / 60_000)} minutes ago`;
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Devices({ devices, locked, onRevoked }: { devices: Device[] | null; locked: boolean; onRevoked(): void }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (devices === null) return <Field label="…" plain />;
  if (devices.length === 0) return <Field label="No phone is paired yet" plain data-dag-remote-devices-empty="" />;

  const revoke = async (id: string) => {
    if (locked) return void refuseLocked();
    setAsking(null);
    setProblem(null);
    try {
      await call<{ revoked: boolean }>("POST", "/api/remote/devices/revoke", { id });
    } catch (e) {
      setProblem(say(e));
    }
    onRevoked();
  };

  return (
    <>
      {devices.map((d) => (
        <Field key={d.id} label={d.name} hint={`Paired ${when(d.created)} · last seen ${when(d.seen)}`} plain data-dag-remote-device={d.id}>
          {asking === d.id ? (
            <span className="dag-settings__actions">
              <span className="dag-settings__desc">Cut it off now?</span>
              <button type="button" className="dag-button" data-dag-remote-revoke-yes="" onClick={() => void revoke(d.id)}>
                Unpair
              </button>
              <button type="button" className="dag-button" onClick={() => setAsking(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="dag-button" data-dag-remote-revoke="" disabled={locked} onClick={() => setAsking(d.id)}>
              Unpair
            </button>
          )}
        </Field>
      ))}
      {problem ? (
        <p className="dag-settings__problem" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- a phone */

function ThisDevice({ device }: { device: Device }) {
  const [asking, setAsking] = useState(false);
  const [gone, setGone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (gone)
    return (
      <Hint data-dag-remote-forgotten="">
        This phone is no longer paired. To pair it again, show a new code in Settings → Devices on the desktop.
      </Hint>
    );

  const forget = async () => {
    setProblem(null);
    try {
      await call("POST", "/api/device/forget");
      setGone(true);
    } catch (e) {
      setProblem(say(e));
    }
  };

  return (
    <>
      <Group title="This device">
        <Field label={device.name} hint={`Paired ${when(device.created)}`} plain data-dag-remote-this="" />
        <Field label="Forget this device" hint="It stops reaching the desktop at once, and pairs again only with a new code." plain>
          {asking ? (
            <span className="dag-settings__actions">
              <button type="button" className="dag-button" data-dag-remote-forget-yes="" onClick={() => void forget()}>
                Forget
              </button>
              <button type="button" className="dag-button" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="dag-button" data-dag-remote-forget="" onClick={() => setAsking(true)}>
              Forget
            </button>
          )}
        </Field>
      </Group>
      {problem ? (
        <p className="dag-settings__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <Hint>Everything you do here runs on the desktop, with its vaults and its Assistant. Turning the desktop off takes this phone offline.</Hint>
    </>
  );
}
