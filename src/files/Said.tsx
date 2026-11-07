/**
 * A refusal as the server words it — `\`.exe\` files cannot be uploaded here` — drawn with the
 * backticked name as code rather than with its backticks. The sentence is the api's, word for word,
 * and a test or an agent reads the same words; only the page draws the ticks.
 */
import { Fragment } from "react";

export function Said({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <code key={i} className="dag-said__code">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
