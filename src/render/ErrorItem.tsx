import type { Code } from "@/dsl/codes";

export interface Shown {
  line: number;
  code: Code;
  message: string;
}

/**
 * Where an item goes when it cannot be drawn and there is no earlier drawing to keep.
 *
 * It used to be the red card above, the diagram's whole width, listing every message — on the
 * surface that is meant to be a picture, and there until somebody fixed the text. It is a small grey
 * stand-in now: enough to say something is here, to be selected, moved, opened and deleted like the
 * item it stands for. The messages are the dock's and the panel's to show; this one carries them
 * only as `data-dag-diagnostics`, and `data-dag-error` is what a check asserting "nothing is broken"
 * looks for.
 */
export function BrokenItem({ what, messages, why }: { what: string; messages: Shown[]; why?: string }) {
  const n = messages.length;
  return (
    <div
      className="dag-broken"
      data-dag-error=""
      data-dag-diagnostics={JSON.stringify(messages)}
      title={messages.map((m) => `Line ${m.line}: ${m.message}`).join("\n") || why}
    >
      <span className="dag-broken__what">{what}</span>
      <span className="dag-broken__why">{why ?? `can't be drawn · ${n} problem${n === 1 ? "" : "s"}`}</span>
    </div>
  );
}
