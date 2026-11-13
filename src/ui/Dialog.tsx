import { useEffect, useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

/**
 * The app's one dialog frame (#208): the Settings modal's, lifted out so Feedback, Search and the
 * logs question are the same thing.
 *
 * - **Over everything, in a portal on `<body>`**, on `--dag-ui-layer-modal`, with one scrim colour.
 *   Search used to sit inside the page with no scrim and leave the sidebar bright and live beside it.
 * - **Tab and shift+Tab go round the card and never leave it.** Search said `aria-modal="true"` and
 *   Tab walked out of it into the sidebar behind; the trap is Settings', and now everybody's.
 * - **What is behind is `inert`** while it is up — every branch of the document but the dialog and
 *   the toast stack — so a pointer, a screen reader's cursor or a stray focus cannot reach the page.
 *   What a dialog opens after it is up (a model picker's list, a tooltip) is drawn after it, and is
 *   left alone.
 * - **It owns every key aimed at it**: Escape closes it unless something inside took the key first
 *   (`preventDefault`), and no key goes on to the page. `useEditor`'s capture-phase handler, which
 *   runs before any of this, returns on a target inside `[data-dag-dialog]`.
 * - **A press on the scrim closes it**, unless `onClose` is absent for the moment (a send in flight).
 *
 * The card is the caller's: its class, its label, its contents. `scrim` carries the data attributes
 * the suite and the page already look for on the outer element (`data-dag-settings`,
 * `data-dag-boards`, `data-dag-feedback`).
 */
export function Dialog({
  onClose,
  scrim,
  cardRef,
  children,
  onKeyDown,
  ...card
}: {
  /** Escape and a press on the scrim. Absent: neither closes it (the caller is busy). */
  onClose?(): void;
  /** Data attributes for the scrim, the element that stands for the whole dialog. */
  scrim?: { [key: `data-${string}`]: string | undefined };
  cardRef?: Ref<HTMLElement>;
  children: ReactNode;
} & HTMLAttributes<HTMLElement> & { [key: `data-${string}`]: string | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const at = root.current;
    if (!at) return;
    const stack = document.querySelector("[data-dag-toasts]");
    const release = inertOthers(stack ? [at, stack] : [at]);
    /* The focus starts inside, so the trap and Escape hear the first key. A card that put it
       somewhere of its own already (a search field, an open tab) keeps it there. */
    if (!own.current?.contains(document.activeElement)) own.current?.focus();
    return release;
  }, []);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    /* A portal opened from inside (a delete question, a picker's list) bubbles here through React
       but is not in this element: its keys are its own. */
    if (!own.current?.contains(e.target as Node)) return;
    onKeyDown?.(e);
    if (e.key === "Escape" && !e.defaultPrevented && onClose) {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab" && !e.defaultPrevented) trap(e, own.current);
    /* Every key stops here, so none reaches the page behind the dialog. */
    e.stopPropagation();
  };

  return createPortal(
    <div ref={root} {...scrim} className="dag-dialog" data-dag-dialog="" onPointerDown={onClose ? () => onClose() : undefined}>
      <section
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        {...card}
        ref={(el) => {
          own.current = el;
          if (typeof cardRef === "function") cardRef(el);
          else if (cardRef) cardRef.current = el;
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          card.onPointerDown?.(e);
        }}
        onKeyDown={onKey}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}

/** What can take the focus, in document order. */
const FOCUSABLE =
  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';

/** Tab off the last control goes to the first, and shift+Tab off the first to the last. */
function trap(e: KeyboardEvent<HTMLElement>, card: HTMLElement): void {
  const all = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
  if (all.length === 0) {
    e.preventDefault();
    return;
  }
  const first = all[0]!;
  const last = all[all.length - 1]!;
  const at = document.activeElement;
  if (e.shiftKey && (at === first || !all.includes(at as HTMLElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !all.includes(at as HTMLElement))) {
    e.preventDefault();
    first.focus();
  }
}

/* Which elements a dialog made inert, and how many dialogs hold each: two open at once (Settings
   asked for from inside the flashcards dialog) let go in either order without waking the page. */
const held = new Map<HTMLElement, number>();

/**
 * Everything in the document but `keep` and the branches that lead to them made `inert`, and the
 * function that undoes it. Each level is walked from the body down: a sibling of a kept branch goes
 * inert whole, and a kept branch is walked into, so the toast stack inside `Shell` stays live while
 * the sidebar beside it does not. An element somebody else made inert is left as it is.
 */
function inertOthers(keep: readonly Element[]): () => void {
  const path = new Set<Element>();
  for (const k of keep) for (let n: Element | null = k; n && n !== document.body; n = n.parentElement) path.add(n);
  const made: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (keep.includes(child)) continue;
      if (path.has(child)) {
        walk(child);
        continue;
      }
      if (!(child instanceof HTMLElement) || child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      const n = held.get(child);
      if (n === undefined && child.inert) continue;
      held.set(child, (n ?? 0) + 1);
      child.inert = true;
      made.push(child);
    }
  };
  walk(document.body);
  return () => {
    for (const el of made) {
      const n = (held.get(el) ?? 1) - 1;
      if (n > 0) held.set(el, n);
      else {
        held.delete(el);
        el.inert = false;
      }
    }
  };
}
