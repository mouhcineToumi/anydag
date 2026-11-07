import { Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";

const ICON = { size: 16, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

interface Props {
  /** The diagram's title, when it has one: an id is the file's name for it, not the reader's. */
  subject?: string;
  text: string;
  onText(text: string): void;
  /** Send the description. `App` closes the dialog and the toolbar shows the run. */
  onSend(): void;
  onClose(): void;
}

/**
 * Where a change to one diagram is described to a model.
 *
 * It was a text field in the selection bar, always open, over notes and images and pairs of items
 * it would refuse. The toolbar's ✨ is how it opens now, and only on a single diagram; the rest is
 * the settings card's shell, for the settings card's reasons:
 *
 * - **It takes focus and owns its Escape.** `typing()` in `useEditor` leaves a focused TEXTAREA to
 *   itself, so the window's chain never sees the key while somebody types here; the card handles
 *   it and stops it, so Escape closes this and nothing behind it — not the selection, and not a
 *   rewrite `App` would otherwise take the key as a reason to discard.
 * - **A paste stays in it.** `useEditor` listens for `paste` on the document to put things on the
 *   board, so a paste here is stopped on its way up — the feedback card's rule.
 * - **It closes on send.** The answer is drawn *on the diagram*, as a preview, and a card over the
 *   canvas would cover exactly that. The toolbar is where the run is followed and decided.
 *
 * The text is `App`'s, not this card's: "Try again" after a refusal reopens it with what was
 * written, rather than making somebody type a paragraph twice.
 */
export function RewriteDialog({ subject, text, onText, onSend, onClose }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const ready = text.trim().length > 0;
  const send = () => {
    if (ready) onSend();
  };

  return (
    <div className="dag-settings__scrim" data-dag-rewrite-dialog="" onPointerDown={onClose}>
      <section
        className="dag-settings dag-rewrite-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Change with AI"
        onPointerDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            send();
          }
        }}
      >
        <header className="dag-settings__head">
          <Sparkles {...ICON} className="dag-rewrite-dialog__mark" aria-hidden="true" />
          <h2>Change with AI</h2>
          <span className="dag-toolbar__spacer" />
          <button type="button" className="dag-icon" aria-label="Close" data-dag-rewrite-cancel="" onClick={onClose}>
            <X {...ICON} aria-hidden="true" />
          </button>
        </header>
        <p className="dag-rewrite-dialog__lede">
          Describe what should change in {subject ? <strong>{subject}</strong> : "this diagram"}. You see the result on the board
          before anything is saved.
        </p>
        <textarea
          ref={input}
          className="dag-feedback__text"
          data-dag-rewrite-input=""
          rows={4}
          value={text}
          placeholder="For example: split the API into two services, and put the cache in front of the database."
          aria-label="Describe the change"
          onChange={(e) => onText(e.target.value)}
        />
        <div className="dag-settings__foot dag-rewrite-dialog__foot">
          <span className="dag-rewrite-dialog__hint">
            <kbd>ctrl</kbd> <kbd>Enter</kbd> to send
          </span>
          <button
            type="button"
            className="dag-icon dag-icon--wide dag-icon--accent"
            data-dag-rewrite-go=""
            disabled={!ready}
            onClick={send}
          >
            <Sparkles {...ICON} aria-hidden="true" />
            <span>Change it</span>
          </button>
        </div>
      </section>
    </div>
  );
}
