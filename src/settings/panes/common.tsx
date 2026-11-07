import { RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** Lucide at one size and weight, stated once. */
export const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * A titled block of settings: a heading in sentence case, then the rows inside one bordered box with
 * a rule between them — the shape macOS and Notion share, which reads as a list of decisions
 * rather than a form. A group with no rows (only a line of prose) has no box.
 */
export function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="dag-settings__group">
      {title ? <h4 className="dag-settings__section">{title}</h4> : null}
      <div className="dag-settings__card">{children}</div>
      {footer ? <div className="dag-settings__after">{footer}</div> : null}
    </section>
  );
}

/**
 * One setting: what it is and what it does on the left, the control on the right. The whole row is
 * a `<label>` when the control is something to click, so pressing the words toggles a switch or
 * focuses a select; a read-only value is a plain row. `stack` puts the control under the words, for
 * one that needs the width — a command to copy, a path.
 */
export function Field({
  label,
  hint,
  children,
  plain,
  stack,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Not a `<label>`: the row holds buttons, or nothing to click at all. */
  plain?: boolean;
  stack?: boolean;
} & Record<`data-${string}`, string>) {
  const Row = plain ? "div" : "label";
  return (
    <Row className={`dag-settings__row${stack ? " dag-settings__row--stack" : ""}`} {...rest}>
      <span className="dag-settings__label">
        <span className="dag-settings__name">{label}</span>
        {hint ? <span className="dag-settings__desc">{hint}</span> : null}
      </span>
      {children !== undefined ? <span className="dag-settings__control">{children}</span> : null}
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
 * Back to the defaults, for what this tab shows and nothing else. Quiet, at the foot of the
 * tab, because it is the one control nobody should press by accident; the title names what it
 * resets, because "Reset" on its own is a question a person should not have to press to answer.
 */
export function Reset({ what, onReset }: { what: string; onReset(): void }) {
  return (
    <footer className="dag-settings__foot">
      <button type="button" className="dag-settings__reset" data-dag-setting-reset="" onClick={onReset} title={`Put ${what} back as they were`}>
        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
        <span>Reset to defaults</span>
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
