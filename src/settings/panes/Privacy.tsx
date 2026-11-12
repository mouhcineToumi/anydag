import { useState } from "react";

import { setConsent, useTelemetry } from "@/telemetry/client";
import { NEVER, SENT } from "@/telemetry/what";
import { Switch } from "@/ui/controls";
import { markSaved } from "../saved";

import { Field, Group, Hint } from "./common";

/**
 * Logs: whether this install sends them, what they hold, and where they go. The person's,
 * in every vault — the answer is the app's server's (`server/telemetry.ts`), not this browser's,
 * which is why it is under the app's group and asked for rather than read from `localStorage`.
 */
export function PrivacyPane() {
  const status = useTelemetry();
  const [failed, setFailed] = useState(false);
  const on = status?.consent === true;

  return (
    <>
      <Group title="Logs">
        <Field
          label="Send anonymous logs"
          hint={
            failed
              ? "That did not save. Try again in a moment."
              : "Errors, which features are used, and how fast pages draw. Nothing you write, and nothing that names you."
          }
          save="telemetry.consent"
        >
          <Switch
            data-dag-setting-telemetry=""
            checked={on}
            disabled={status === null}
            onChange={(e) => {
              setFailed(false);
              void setConsent(e.target.checked).then((ok) => (ok ? markSaved("telemetry.consent") : setFailed(true)));
            }}
          />
        </Field>
        <Field label="Where they go" plain data-dag-setting-telemetry-to="">
          <span className="dag-settings__value">
            {status === null ? "…" : (status.destination ?? "Nowhere yet: no sync server is paired and none is set")}
          </span>
        </Field>
      </Group>

      <Group title="What is sent">
        <ul className="dag-telemetry__list">
          {SENT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Group>

      <Group title="Never sent">
        <ul className="dag-telemetry__list">
          {NEVER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Group>

      <Hint>
        Turning this off drops anything not yet sent and forgets the install id. Nothing is sent from a snapshot or a read-only
        page.
      </Hint>
    </>
  );
}
