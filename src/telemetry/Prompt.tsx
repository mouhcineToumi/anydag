import { Activity, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog } from "@/ui/Dialog";
import { Toast, toastAct } from "@/ui/Toast";

import { setConsent, useTelemetry } from "./client";
import { NEVER, SENT } from "./what";

/** The question, in one line. */
const ASK = "Send anonymous logs to help fix crashes? Never your files or names.";

/** How long a file stays open before the question appears: it is about using the app, not arriving. */
const ASK_AFTER = 3000;

/**
 * The question asked once per install, after a file has been open for a moment: may the app send
 * logs. Nothing is sent before it is answered, and either answer is the end of it — Settings →
 * Privacy is where it changes. Drawn by `Shell`, so never on a snapshot, a read-only view or the
 * vault picker.
 *
 * A toast rather than a modal: arriving is not the moment to be asked, and a board, note, quiz or
 * table being open is the moment it is about. It does not take the focus, so the page stays usable
 * behind it; a key aimed at one of its buttons stops there, and Escape in it is *No*. *What's sent*
 * opens the app's dialog frame with the two lists and the same two answers; Escape there goes back
 * to the toast.
 */
export function TelemetryPrompt({ page }: { page: string | null }) {
  const status = useTelemetry();
  /* Once asked, it stays until it is answered: moving to another file, or Home, does not take it
     away and bring it back three seconds later. */
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [what, setWhat] = useState(false);

  useEffect(() => {
    if (shown || !page) return;
    /* A new page restarts the wait: the question comes after one file has been open a moment. */
    const timer = window.setTimeout(() => setShown(true), ASK_AFTER);
    return () => window.clearTimeout(timer);
  }, [page, shown]);

  const asking = shown && status?.consent === null;

  if (!asking) return null;

  const answer = (yes: boolean) => {
    setBusy(true);
    setFailed(false);
    void setConsent(yes).then((ok) => {
      setBusy(false);
      if (!ok) setFailed(true);
    });
  };

  /* *What's sent* is the same question asked at length, in the app's dialog frame: the lists, then
     the answer. While it is up the toast steps aside, so the question is on screen once. */
  if (what)
    return (
      <Dialog
        className="dag-settings dag-telemetry-dialog"
        aria-labelledby="dag-telemetry-ask-title"
        scrim={{ "data-dag-telemetry-ask": "" }}
        onClose={busy ? undefined : () => setWhat(false)}
      >
        <header className="dag-settings__head">
          <Activity size={14} strokeWidth={2} aria-hidden="true" className="dag-telemetry-dialog__mark" />
          <h2 id="dag-telemetry-ask-title">Send anonymous logs?</h2>
          <span className="dag-toolbar__spacer" />
          <button
            type="button"
            className="dag-icon"
            aria-label="Back"
            title="Back (Escape)"
            disabled={busy}
            onClick={() => setWhat(false)}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
        <div id="dag-telemetry-ask-what">
          <p className="dag-telemetry-dialog__label">What is sent</p>
          <ul className="dag-telemetry-dialog__list">
            {SENT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="dag-telemetry-dialog__label">Never sent</p>
          <ul className="dag-telemetry-dialog__list">
            {NEVER.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="dag-telemetry-dialog__hint">You can change this at any time in Settings → Privacy.</p>
        </div>
        {failed ? (
          <p className="dag-telemetry-dialog__failed" role="alert">
            That did not save. Try again in a moment.
          </p>
        ) : null}
        <div className="dag-settings__foot">
          <button type="button" className="dag-button" data-dag-telemetry-no="" disabled={busy} onClick={() => answer(false)}>
            No
          </button>
          <button
            type="button"
            className="dag-button dag-button--primary"
            data-dag-telemetry-yes=""
            disabled={busy}
            onClick={() => answer(true)}
          >
            Send
          </button>
        </div>
      </Dialog>
    );

  return (
    <Toast
      icon={Activity}
      tone="accent"
      data-dag-telemetry-ask=""
      title={failed ? `${ASK} That did not save. Try again in a moment.` : ASK}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          e.stopPropagation();
          answer(false);
        }
      }}
      actions={
        <>
          <button
            type="button"
            className={toastAct()}
            data-dag-telemetry-what=""
            aria-haspopup="dialog"
            onClick={() => setWhat(true)}
          >
            What's sent
          </button>
          <button type="button" className={toastAct()} data-dag-telemetry-no="" disabled={busy} onClick={() => answer(false)}>
            No
          </button>
          <button type="button" className={toastAct(true)} data-dag-telemetry-yes="" disabled={busy} onClick={() => answer(true)}>
            Send
          </button>
        </>
      }
    >
      {failed ? "That did not save. Try again in a moment." : ASK}
    </Toast>
  );
}
