/**
 * What a drop onto the board was refused with: a file past this deployment's size limit,
 * a type it does not take, a network that gave out. A drop has no dialog to answer in, so the board
 * says so in the toast stack, for a few seconds or until it is put away — one toast a refusal, so
 * three files refused at once are three lines rather than one card three lines tall.
 *
 * A document event, `dag:upload-problem`, carrying the sentence — `useEditor` raises it and knows
 * nothing about how it is shown.
 */
import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Toast } from "@/ui/Toast";

import { Said } from "./Said";

/** How long a refusal stays up when nobody puts it away. */
const SHOWN_FOR = 8000;

export function UploadNotice() {
  /* Each line with a count of how many times it was said, so the same refusal again starts its
     wait again rather than being a second toast saying the same thing. */
  const [said, setSaid] = useState<{ line: string; n: number }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const line = (e as CustomEvent<string>).detail;
      if (typeof line !== "string") return;
      setSaid((was) => {
        const had = was.find((s) => s.line === line);
        return had ? was.map((s) => (s === had ? { line, n: s.n + 1 } : s)) : [...was, { line, n: 0 }];
      });
    };
    document.addEventListener("dag:upload-problem", on);
    return () => document.removeEventListener("dag:upload-problem", on);
  }, []);
  const drop = (line: string) => setSaid((was) => was.filter((s) => s.line !== line));
  return (
    <>
      {said.map(({ line, n }) => (
        <Toast
          key={line}
          icon={AlertCircle}
          tone="danger"
          role="alert"
          data-dag-upload-problem=""
          title={line}
          timeout={SHOWN_FOR}
          renew={n}
          onTimeout={() => drop(line)}
          onDismiss={() => drop(line)}
        >
          <Said text={line} />
        </Toast>
      ))}
    </>
  );
}
