import { Check, RotateCcw, Sparkles } from "lucide-react";
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { useResetToast, useSaved } from "../feedback";
import { quietly } from "../saved";

/** Lucide at one size and weight, stated once. */
export const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * A titled block of settings: a heading in sentence case, then the rows inside one bordered box with
 * a rule between them — the shape macOS and Notion share, which reads as a list of decisions
 * rather than a form. A group with no rows (only a line of prose) has no box.
 */
export function Group({
  title,
  children,
  footer,
  prompt = false,
}: {
  title?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /**
   * A group that sets what a prompt card runs on wears the card's look: the heading is its Sparkles
   * and small accent capitals, and the box is its dashed accent edge. A person who has made a prompt
   * card recognises where its model comes from.
   */
  prompt?: boolean;
}) {
  return (
    <section className={prompt ? "dag-settings__group dag-settings__group--prompt" : "dag-settings__group"}>
      {title ? (
        <h4 className="dag-settings__section">
          {prompt ? <Sparkles {...ICON} size={13} aria-hidden="true" /> : null}
          {title}
        </h4>
      ) : null}
      {children === undefined || children === null ? null : <div className="dag-settings__card">{children}</div>}
      {footer ? <div className="dag-settings__after">{footer}</div> : null}
    </section>
  );
}

/**
 * Put the row's name and hint on the control itself.
 *
 * A row drawn as a `<label>` names one control implicitly, but a `plain` row — the Sync fields, a
 * key field beside its Save — is a `<div>`, and there the visible words named nothing. A control
 * that can carry a name gets `aria-labelledby`/`aria-describedby`; a wrapper keeps its own
 * `aria-label` (the API key fields do), and a fragment is walked.
 */
function named(node: ReactNode, labelId: string, hintId?: string): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child;
    if (child.type === Fragment) return named((child.props as { children?: ReactNode }).children, labelId, hintId);
    if (typeof child.type === "string" && !["input", "select", "textarea"].includes(child.type)) return child;
    const props: Record<string, string> = { "aria-labelledby": labelId };
    if (hintId) props["aria-describedby"] = hintId;
    return cloneElement(child as ReactElement<Record<string, string>>, props);
  });
}

/**
 * One setting: what it is and what it does on the left, the control on the right. The whole row is
 * a `<label>` when the control is something to click, so pressing the words toggles a switch or
 * focuses a select; a read-only value is a plain row. `stack` puts the control under the words, for
 * one that needs the width — a command to copy, a path.
 *
 * `save` is the key this row's writes announce (`paste.width`, `dag:week-start`); the tick beside
 * the control appears when one lands. A text field passes `settle` so the tick waits for a pause in
 * the typing rather than blinking under the caret, and leaving the field shows it at once.
 */
export function Field({
  label,
  hint,
  children,
  plain,
  stack,
  save,
  settle = 0,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Not a `<label>`: the row holds buttons, or nothing to click at all. */
  plain?: boolean;
  stack?: boolean;
  /** The `markSaved` key this row's control writes, when it writes one. */
  save?: string;
  /** Milliseconds of quiet before a text field's tick shows; zero for a control that writes once. */
  settle?: number;
} & Record<`data-${string}`, string>) {
  const id = useId();
  const labelId = `${id}-name`;
  const hintId = `${id}-hint`;
  const Row = plain ? "div" : "label";
  const saved = useSaved(save, settle);
  return (
    <Row className={`dag-settings__row${stack ? " dag-settings__row--stack" : ""}`} {...rest}>
      <span className="dag-settings__label">
        <span className="dag-settings__name" id={labelId}>
          {label}
        </span>
        {hint ? (
          <span className="dag-settings__desc" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
      {children !== undefined ? (
        <span className="dag-settings__control" onBlurCapture={saved.flush}>
          {saved.shown ? (
            <span className="dag-settings__saved" data-dag-setting-saved="" aria-hidden="true">
              <Check size={12} strokeWidth={2} />
              <span>Saved</span>
            </span>
          ) : null}
          {named(children, labelId, hint ? hintId : undefined)}
        </span>
      ) : null}
    </Row>
  );
}

/** A line of prose under a group, for what no single row says. */
export function Hint({ children, ...rest }: { children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <p className="dag-settings__hint" {...rest}>
      {children}
    </p>
  );
}

/**
 * A quiet list of facts — a name, a path, a version, a limit — as a label and a value, with no
 * control and no box around it. A fact is not a setting: there is nothing here to press, so it must
 * not read like the rows that can be changed. A `Fact` may still hold a button, for an action about
 * the value such as *Show in folder*.
 */
export function Facts({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="dag-settings__group">
      {title ? <h4 className="dag-settings__section">{title}</h4> : null}
      <dl className="dag-settings__facts">{children}</dl>
      {footer ? <div className="dag-settings__after">{footer}</div> : null}
    </section>
  );
}

/** One fact in a {@link Facts} list. */
export function Fact({
  label,
  children,
  stack,
  ...rest
}: {
  label: ReactNode;
  children: ReactNode;
  stack?: boolean;
} & Record<`data-${string}`, string>) {
  return (
    <div className={`dag-settings__fact${stack ? " dag-settings__fact--stack" : ""}`} {...rest}>
      <dt className="dag-settings__factName">{label}</dt>
      <dd className="dag-settings__factValue">{children}</dd>
    </div>
  );
}

/**
 * Back to the defaults, for what this tab shows and nothing else. Quiet, at the foot of the
 * tab, because it is the one control nobody should press by accident. The button names its scope in
 * its own text — "Reset Diagrams to defaults" — and the action hands back Undo, which the modal
 * offers for six seconds. The writes the reset itself makes are quiet: the toast is its answer.
 */
export function Reset({ what, onReset }: { what: string; onReset(): () => void }) {
  const showReset = useResetToast();
  return (
    <footer className="dag-settings__foot">
      <button
        type="button"
        className="dag-settings__reset"
        data-dag-setting-reset=""
        onClick={() => {
          let undo: () => void = () => undefined;
          quietly(() => {
            undo = onReset();
          });
          showReset(what, undo);
        }}
      >
        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
        <span>Reset {what} to defaults</span>
      </button>
    </footer>
  );
}

/** What `GET /api/health` says about the server: its version, its store, and where its MCP server is. */
export interface Health {
  version: string;
  store: string;
  /** The public origin an MCP client is pointed at; empty when the MCP server is off. */
  mcp: string;
}

/**
 * Asked when a tab that shows it opens, never kept: the server can be restarted with another
 * version or another public address, and the tab is where a person reads which.
 */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
      .then((d) => live && d && setHealth(d))
      /* No server: the tab says it could not ask, which is true. */
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return health;
}

/** The clipboard, `src/ui/clipboard.ts`'s — one copy of the selection fallback. */
export { copyText } from "@/ui/clipboard";
