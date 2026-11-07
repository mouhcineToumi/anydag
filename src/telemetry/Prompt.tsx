import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { setConsent, useTelemetry } from "./client";
import { NEVER, SENT } from "./what";

/**
 * The question asked once per install, on the first page of the app anybody opens: may the app send
 * logs. Nothing is sent before it is answered, and either answer is the end of it — Settings →
 * Privacy is where it changes. Drawn by `Shell`, so never on a snapshot, a read-only view or the
 * vault picker.
 *
 * A modal because it is a question the person answers rather than a notice they may ignore, and
 * because a default nobody chose is exactly what this card exists to avoid. Escape is *No*.
 */
export function TelemetryPrompt() {
  const status = useTelemetry();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const asking = status?.consent === null && status.answerable !== false;

  useEffect(() => {
    if (asking) card.current?.focus();
  }, [asking]);

  if (!asking) return null;

  const answer = (yes: boolean) => {
    setBusy(true);
    setFailed(false);
    void setConsent(yes).then((ok) => {
      setBusy(false);
      if (!ok) setFailed(true);
    });
  };

  return createPortal(
    <div className="dag-settings__scrim dag-telemetry-ask__scrim" data-dag-telemetry-ask="">
      <div
        ref={card}
        className="dag-settings dag-telemetry-ask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dag-telemetry-ask-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            e.stopPropagation();
            answer(false);
          }
          /* Every other key stops here: the board's own keys must not act behind a question. */
          e.stopPropagation();
        }}
      >
        <header className="dag-settings__head">
          <Activity size={16} strokeWidth={2} aria-hidden="true" className="dag-telemetry-ask__mark" />
          <h2 id="dag-telemetry-ask-title">Help improve AnyDag?</h2>
        </header>
        <p className="dag-telemetry-ask__lead">
          AnyDag can send anonymous logs about how it is running, so crashes get found and fixed. It is off until you say yes.
        </p>
        <p className="dag-telemetry-ask__label">What is sent</p>
        <ul className="dag-telemetry-ask__list">
          {SENT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="dag-telemetry-ask__label">Never sent</p>
        <ul className="dag-telemetry-ask__list">
          {NEVER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="dag-telemetry-ask__hint">You can change this at any time in Settings → Privacy.</p>
        {failed ? (
          <p className="dag-telemetry-ask__failed" role="alert">
            That did not save. Try again in a moment.
          </p>
        ) : null}
        <footer className="dag-settings__foot dag-telemetry-ask__foot">
          <button type="button" className="dag-button" data-dag-telemetry-no="" disabled={busy} onClick={() => answer(false)}>
            No thanks
          </button>
          <button type="button" className="dag-button dag-button--primary" data-dag-telemetry-yes="" disabled={busy} onClick={() => answer(true)}>
            Send anonymous logs
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
