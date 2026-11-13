import { Check } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { Toast, toastAct } from "@/ui/Toast";

import { SAVED, type SavedDetail } from "./saved";

/** How long the tick beside a row stays up, fade included. */
const SAVED_FOR = 1500;
/** How long a reset's Undo is offered. */
const RESET_FOR = 6000;
/** How long a text field waits after typing before it says its write settled. Longer than a pause between two keystrokes. */
export const SETTLE = 600;

/* The rows on screen, by key and how many draw it. A preference written elsewhere while the modal is
   open — the sidebar's width, the calendar noting the zone it saw — is not a save anyone made here,
   and the live region must not say "Saved" for it. */
const watched = new Map<string, number>();

/**
 * The tick beside one row.
 *
 * The write event names its row, so a row hears only its own. `settle` is for a text field, whose
 * write happens on every keystroke: the tick waits for a pause instead of blinking under the caret,
 * and `flush` shows it the moment the field is left.
 */
export function useSaved(key: string | undefined, settle = 0): { shown: boolean; flush(): void } {
  const [shown, setShown] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* A write fired by the blur itself lands after the capture handler; it should show at once. */
  const soon = useRef(false);

  const flush = useCallback(() => {
    if (pending.current !== null) {
      clearTimeout(pending.current);
      pending.current = null;
      setShown((n) => n + 1);
      return;
    }
    soon.current = true;
    setTimeout(() => {
      soon.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (!key) return;
    watched.set(key, (watched.get(key) ?? 0) + 1);
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<SavedDetail>).detail?.key !== key) return;
      if (settle <= 0 || soon.current) {
        soon.current = false;
        setShown((n) => n + 1);
        return;
      }
      if (pending.current !== null) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        pending.current = null;
        setShown((n) => n + 1);
      }, settle);
    };
    addEventListener(SAVED, onSaved);
    return () => {
      const n = (watched.get(key) ?? 1) - 1;
      if (n > 0) watched.set(key, n);
      else watched.delete(key);
      removeEventListener(SAVED, onSaved);
      if (pending.current !== null) {
        clearTimeout(pending.current);
        pending.current = null;
      }
    };
  }, [key, settle]);

  useEffect(() => {
    if (shown === 0) return;
    const timer = setTimeout(() => setShown(0), SAVED_FOR);
    return () => clearTimeout(timer);
  }, [shown]);

  return { shown: shown > 0, flush };
}

type ShowReset = (scope: string, undo: () => void) => void;

const ResetContext = createContext<ShowReset>(() => undefined);

/** What a `Reset` calls to offer Undo; the modal draws the result. */
export function useResetToast(): ShowReset {
  return useContext(ResetContext);
}

/**
 * Settings' feedback: the one polite live region every save and reset is announced through, and the
 * toast a reset raises.
 *
 * The tick itself is `aria-hidden`, because the region already says "Saved" — a live region per row
 * would read the same word as many times as there are controls. The reset toast is the app's one
 * `Toast`, drawn at the modal's foot: it stays while the pointer or the focus is on it, so it cannot
 * go from under a hand reaching for Undo.
 */
export function SettingsFeedback({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ scope: string; undo(): void } | null>(null);
  const [said, setSaid] = useState({ text: "", alt: false });

  /* A second identical string is not announced again, so alternate a zero-width space after it. */
  const say = useCallback((text: string) => setSaid((old) => ({ text, alt: !old.alt })), []);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const key = (e as CustomEvent<SavedDetail>).detail?.key;
      if (key && watched.has(key)) say("Saved");
    };
    addEventListener(SAVED, onSaved);
    return () => removeEventListener(SAVED, onSaved);
  }, [say]);

  const show = useCallback<ShowReset>(
    (scope, undo) => {
      setToast({ scope, undo });
      say(`${scope} reset. Undo is available for six seconds.`);
    },
    [say],
  );

  return (
    <ResetContext.Provider value={show}>
      {children}
      {toast ? (
        /* The app's one toast, drawn inside the modal at its foot rather than in the page's stack:
           the modal keeps the focus, and Undo has to be within the reach of Tab. */
        <Toast
          inline
          icon={Check}
          data-dag-setting-reset-toast={toast.scope}
          title={`${toast.scope} reset`}
          timeout={RESET_FOR}
          renew={toast}
          onTimeout={() => setToast(null)}
          actions={
            <button
              type="button"
              className={toastAct()}
              data-dag-setting-reset-undo=""
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                undo();
              }}
            >
              Undo
            </button>
          }
        >
          {toast.scope} reset
        </Toast>
      ) : null}
      <span className="dag-settings__said" role="status" aria-live="polite" aria-atomic="true" data-dag-setting-said="">
        {said.text}
        {said.alt ? "\u200B" : ""}
      </span>
    </ResetContext.Provider>
  );
}
