/**
 * What a drop onto the board was refused with: a file past this deployment's size limit,
 * a type it does not take, a network that gave out. A drop has no dialog to answer in, so the board
 * says so here, over the canvas, for a few seconds or until it is put away.
 *
 * A document event, `dag:upload-problem`, carrying the sentence — `useEditor` raises it and knows
 * nothing about how it is shown.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Said } from "./Said";

/** How long a refusal stays up when nobody puts it away. */
const SHOWN_FOR = 8000;

export function UploadNotice() {
  const [said, setSaid] = useState<string[]>([]);
  useEffect(() => {
    let timer: number | undefined;
    const on = (e: Event) => {
      const line = (e as CustomEvent<string>).detail;
      if (typeof line !== "string") return;
      setSaid((was) => (was.includes(line) ? was : [...was, line]));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSaid([]), SHOWN_FOR);
    };
    document.addEventListener("dag:upload-problem", on);
    return () => {
      document.removeEventListener("dag:upload-problem", on);
      window.clearTimeout(timer);
    };
  }, []);
  if (!said.length) return null;
  return (
    <div className="dag-upload-notice" role="alert" data-dag-upload-problem="">
      <div className="dag-upload-notice__lines">
        {said.map((line) => (
          <p key={line}>
            <Said text={line} />
          </p>
        ))}
      </div>
      <button type="button" className="dag-icon" aria-label="Dismiss" title="Dismiss" onClick={() => setSaid([])}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
