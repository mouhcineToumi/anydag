import { Activity } from "lucide-react";
import { useEffect, useState } from "react";

import { setConsent, useTelemetry } from "./client";
import { NEVER, SENT } from "./what";

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
 * behind it; a key aimed at one of its buttons stops there, and Escape in it is *No*.
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

  return (
    <div
      className="dag-telemetry-toast"
      data-dag-telemetry-ask=""
      role="status"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          e.stopPropagation();
          answer(false);
        }
      }}
    >
      <div className="dag-telemetry-toast__row">
        <Activity size={16} strokeWidth={2} aria-hidden="true" className="dag-telemetry-toast__mark" />
        <p className="dag-telemetry-toast__text">Send anonymous logs to help fix crashes? Never your files or names.</p>
      </div>
      {what ? (
        <div className="dag-telemetry-toast__what" id="dag-telemetry-ask-what">
          <p className="dag-telemetry-toast__label">What is sent</p>
          <ul className="dag-telemetry-toast__list">
            {SENT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="dag-telemetry-toast__label">Never sent</p>
          <ul className="dag-telemetry-toast__list">
            {NEVER.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="dag-telemetry-toast__hint">You can change this at any time in Settings → Privacy.</p>
        </div>
      ) : null}
      {failed ? (
        <p className="dag-telemetry-toast__failed" role="alert">
          That did not save. Try again in a moment.
        </p>
      ) : null}
      <div className="dag-telemetry-toast__acts">
        <button
          type="button"
          className="dag-telemetry-toast__act"
          data-dag-telemetry-what=""
          aria-expanded={what}
          aria-controls="dag-telemetry-ask-what"
          onClick={() => setWhat((v) => !v)}
        >
          What's sent
        </button>
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
    </div>
  );
}
