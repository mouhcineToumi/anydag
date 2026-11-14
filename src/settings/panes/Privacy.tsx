import { useState } from "react";

import { useFeatures } from "@/features";
import { setConsent, useTelemetry } from "@/telemetry/client";
import { NEVER, SENT } from "@/telemetry/what";
import { Switch } from "@/ui/controls";
import { markSaved } from "../saved";

import { Fact, Facts, Field, Group, Hint } from "./common";

/** What the tab says a build that cannot send logs yet does with the choice. */
const HELD = "Logs are not sent from this version yet.";

/**
 * Logs: whether this install sends them, what they hold, and where they go. The person's,
 * in every vault — the answer is the app's server's (`server/telemetry.ts`), not a preference, which
 * is why it is under the app's group and written through its route rather than kept with the
 * settings. In a build that cannot send yet the choice is held in this browser instead (#326), and
 * the first build that can send carries it to the server.
 *
 * **Drawn in every build (#326).** With the `cloud` switch off nothing is sent and no telemetry
 * request is made, but the toggle is still drawn and still records the choice, and one line under it
 * says so. That is the one exception to #103's rule: Sync and Send feedback stay hidden.
 */
export function PrivacyPane() {
  const status = useTelemetry();
  const features = useFeatures();
  const canSend = features?.cloud === true;
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
              : canSend
                ? "Errors, which features are used, and how fast pages draw. Nothing you write, and nothing that names you."
                : HELD
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
      </Group>

      <Facts>
        <Fact label="Where they go" stack data-dag-setting-telemetry-to="">
          <span className="dag-settings__value">
            {canSend
              ? status === null
                ? "…"
                : (status.destination ?? "Nowhere yet: no sync server is paired and none is set")
              : "Nowhere: this version does not send logs yet"}
          </span>
        </Fact>
      </Facts>

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
        {canSend
          ? "Turning this off drops anything not yet sent and forgets the install id. Nothing is sent from a snapshot or a read-only page."
          : "Your choice is kept and applies when a version that sends logs is installed. Nothing is sent from a snapshot or a read-only page."}
      </Hint>
    </>
  );
}
