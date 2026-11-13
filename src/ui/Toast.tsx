import { X, type LucideIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * The app's one toast, and the one stack they all go in (#208).
 *
 * Before this the trash notice, the logs question, a refused upload, the problems notification and
 * the note's notices each had their own place, corner, padding and buttons — 4, 9 or 16 px round,
 * bottom-left, top-centre or in the page's flow — and the trash notice wrapped a long file name over
 * three lines. Now each is a `Toast`: an icon, **one line** of message, then its actions, in a stack
 * at the bottom centre of the page above the dock, on `--dag-ui-layer-toast`. At most three are
 * drawn; a fourth waits under them until one goes.
 *
 * A toast is declarative: the component that owns the state draws one where it always drew its
 * notice, and the toast is portalled into the stack. So the trash notice keeps its Undo, the problems
 * dock its "seen" set and the note its save status, and none of them learned about a store. A state
 * that lasts (a note that could not be saved, the logs question) is a toast with no `timeout`: it
 * stays until it is answered or the state ends.
 *
 * The stack is `ToastHost`'s, inside `Shell`, so it can sit right of a docked sidebar. A toast drawn
 * where there is no host (no page draws one there today) falls back to a stack of its own on the
 * body. The Settings modal draws its reset toast `inline`, inside the card: a modal keeps the focus,
 * and a toast outside it could not be reached from the keyboard.
 */

const HostContext = createContext<HTMLElement | null>(null);

/** Where the toasts go: the stack, drawn after the page so it is above it. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<HTMLElement | null>(null);
  return (
    <HostContext.Provider value={stack}>
      {children}
      <section ref={setStack} className="dag-toasts" data-dag-toasts="" aria-label="Notifications" />
    </HostContext.Provider>
  );
}

let fallback: HTMLElement | null = null;
/** A stack on the body for a toast drawn with no host — made the first time one is needed. */
function bodyStack(): HTMLElement {
  if (fallback?.isConnected) return fallback;
  fallback = document.createElement("section");
  fallback.className = "dag-toasts dag-toasts--body";
  fallback.setAttribute("data-dag-toasts", "");
  fallback.setAttribute("aria-label", "Notifications");
  document.body.append(fallback);
  return fallback;
}

/** A `data-*` attribute, which every notice carries for the suite and the editor's key handler. */
type DataAttrs = { [key: `data-${string}`]: string | undefined };

export interface ToastProps extends DataAttrs {
  /** The mark before the message. */
  icon: LucideIcon;
  /** What the mark says at a glance: `danger` for a failure, `accent` for a question, else plain. */
  tone?: "plain" | "accent" | "danger";
  /** One line. A name in it is a `ToastName`, which gives way in the middle rather than at the end. */
  children: ReactNode;
  /** The whole message as text, for the hover title when the line is cut short. */
  title?: string;
  /** Buttons after the message; `toastAct` is their class. */
  actions?: ReactNode;
  /** Draw a × that calls this. */
  onDismiss?(): void;
  /** The ×'s own data attribute, where the suite already looks for one (`data-dag-trash-dismiss`). */
  dismissData?: DataAttrs;
  /** Go after this many ms, held while the pointer or the focus is on the toast. Absent: stays. */
  timeout?: number;
  /** Called when `timeout` runs out. */
  onTimeout?(): void;
  /** Starts the timeout again when it changes — a new line said in a toast that is already up. */
  renew?: unknown;
  /** `status` (polite, the default) or `alert` (a failure somebody has to know about now). */
  role?: "status" | "alert";
  /** Drawn where it is rendered rather than in the stack: Settings' reset, inside its modal. */
  inline?: boolean;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
}

/** The class an action button in a toast wears; `primary` for the one that answers yes. */
export function toastAct(primary = false): string {
  return primary ? "dag-toast__act dag-toast__act--primary" : "dag-toast__act";
}

export function Toast({
  icon: Icon,
  tone = "plain",
  children,
  title,
  actions,
  onDismiss,
  dismissData,
  timeout,
  onTimeout,
  renew,
  role = "status",
  inline = false,
  onKeyDown,
  ...data
}: ToastProps) {
  const host = useContext(HostContext);
  const [held, setHeld] = useState(false);
  const done = useRef(onTimeout);
  done.current = onTimeout;

  /* It never goes from under a hand reaching for it: the pointer or the focus on it holds it, and
     letting go starts the whole wait again. */
  useEffect(() => {
    if (timeout === undefined || held) return;
    const timer = window.setTimeout(() => done.current?.(), timeout);
    return () => window.clearTimeout(timer);
  }, [timeout, held, renew]);

  const toast = (
    <div
      {...data}
      className={`dag-toast dag-toast--${tone}`}
      data-dag-toast=""
      role={role}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={onKeyDown}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" className="dag-toast__mark" />
      <p className="dag-toast__text" title={title}>
        {children}
      </p>
      {actions ? <div className="dag-toast__acts">{actions}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          className="dag-icon dag-toast__close"
          data-dag-toast-dismiss=""
          {...dismissData}
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
  if (inline) return toast;
  /* `document` is there in every page that draws one; the host is a frame late on the first render. */
  const stack = host ?? (typeof document === "undefined" ? null : bodyStack());
  return stack ? createPortal(toast, stack) : null;
}

/** How many characters of a name stay at its end when it is cut: the extension and a bit before. */
const TAIL = 10;

/**
 * A file's name inside a toast's line, which gives way **in the middle** when the line is too long:
 * `Quarterly planning for…2026 draft.pdf`, so the start and the extension both stay. The full name
 * is the title. The rest of the line keeps its words; only this part shrinks.
 */
export function ToastName({ text }: { text: string }) {
  const cut = text.length > TAIL * 2 ? text.length - TAIL : text.length;
  return (
    <span className="dag-toast__name" title={text}>
      <span className="dag-toast__head">{text.slice(0, cut)}</span>
      {cut < text.length ? <span className="dag-toast__tail">{text.slice(cut)}</span> : null}
    </span>
  );
}

/** A run of words in a toast's line that does not shrink — the words around a `ToastName`. */
export function ToastWords({ children }: { children: ReactNode }) {
  return <span className="dag-toast__words">{children}</span>;
}
