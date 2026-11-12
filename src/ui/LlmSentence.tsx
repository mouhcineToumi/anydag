import { Fragment } from "react";

import { sentenceParts } from "@/settings/llmReason";

/** A reason's sentence, with an environment variable drawn as code rather than as a backtick. */
export function LlmSentence({ text }: { text: string }) {
  return (
    <>
      {sentenceParts(text).map((part, i) => (
        <Fragment key={i}>{typeof part === "string" ? part : <code>{part.code}</code>}</Fragment>
      ))}
    </>
  );
}
