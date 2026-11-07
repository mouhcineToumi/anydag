import type { Code } from "@/dsl/codes";

export interface Shown {
  line: number;
  code: Code;
  message: string;
}

/**
 * A board that could not be read at all.
 *
 * The one error that still stands on the canvas as a card, because there is nothing else to show:
 * no items, no drawing to fall back on. Everything that is wrong *inside* a board that can be read
 * is the problems dock's to say (`src/ui/Problems.tsx`).
 *
 * The code is rendered as well as the sentence, and the whole list is published as
 * `data-dag-diagnostics` so a tool driving the page can read what went wrong without scraping prose
 * out of the DOM.
 */
export function ErrorItem({ title, messages }: { title: string; messages: Shown[] }) {
  return (
    <div className="dag-error" data-dag-diagnostics={JSON.stringify(messages)}>
      <div className="dag-error__title">{title}</div>
      <ul className="dag-error__list">
        {messages.map((m, i) => (
          <li key={i}>
            <span className="dag-error__line">{m.line}</span>
            <span className="dag-error__code">{m.code}</span>
            {m.message}
          </li>
        ))}
      </ul>
    </div>
  );
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
