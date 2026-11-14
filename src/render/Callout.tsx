/**
 * What a callout looks like: its kind's hue and icon, and the `aside` every read-only page draws one
 * as — a board's text card, a note at `?view=1` or behind a share link, a snapshot, the PDF, a note
 * embedded in a note, a quiz, the Assistant's words. The grammar is `src/note/callout.ts`'s; the note
 * editor draws the same head from the same table (`src/blocks/callout.tsx`).
 *
 * **The colours are the theme's ten hues**, a kind mapped onto the nearest, and `quote` onto none —
 * the theme's own quiet greys, as a plain quote is drawn. In `neutral`, whose hues are greys on
 * purpose, a callout is told apart by its icon. They are bound as `--callout-h` and `--callout-t`
 * (the hue, and its tint), never as `--dag-h`: a callout inside a hued card would otherwise take
 * the card's, and a card inside nothing would take the theme's default.
 */
import {
  Bug,
  ChevronRight,
  Check,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Info,
  Lightbulb,
  List,
  type LucideIcon,
  MessageSquareWarning,
  OctagonAlert,
  Pencil,
  Quote,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { Children, isValidElement, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { ExtraProps } from "react-markdown";

import { calloutKind, type CalloutKind } from "@/note/callout";

/** A kind's hue — one of the theme's ten, or none — and its glyph. */
export const CALLOUT_LOOK: Record<CalloutKind, { hue: string | null; icon: LucideIcon }> = {
  note: { hue: "indigo", icon: Pencil },
  tip: { hue: "spruce", icon: Lightbulb },
  important: { hue: "violet", icon: MessageSquareWarning },
  warning: { hue: "ochre", icon: TriangleAlert },
  caution: { hue: "crimson", icon: OctagonAlert },
  abstract: { hue: "teal", icon: ClipboardList },
  info: { hue: "indigo", icon: Info },
  todo: { hue: "indigo", icon: CircleCheck },
  success: { hue: "moss", icon: Check },
  question: { hue: "bronze", icon: CircleHelp },
  failure: { hue: "crimson", icon: X },
  danger: { hue: "crimson", icon: Zap },
  bug: { hue: "crimson", icon: Bug },
  example: { hue: "magenta", icon: List },
  quote: { hue: null, icon: Quote },
};

/** The hue and tint a callout draws in, bound on its box. */
export function calloutVars(kind: CalloutKind): CSSProperties {
  const hue = CALLOUT_LOOK[kind].hue;
  return (
    hue
      ? { "--callout-h": `var(--dag-color-hues-${hue})`, "--callout-t": `var(--dag-tint-${hue})` }
      : { "--callout-h": "var(--dag-color-slate)", "--callout-t": "var(--dag-color-paper100)" }
  ) as CSSProperties;
}

/** A kind's glyph, decorative: the title says what it is. */
export function CalloutIcon({ kind }: { kind: CalloutKind }): ReactNode {
  const Icon = CALLOUT_LOOK[kind].icon;
  return (
    <span className="dag-callout__icon" aria-hidden="true">
      <Icon />
    </span>
  );
}

type AsideProps = ComponentProps<"aside"> &
  ExtraProps & {
    "data-dag-callout"?: string;
    "data-dag-callout-word"?: string;
    "data-dag-callout-fold"?: string;
  };

/**
 * `react-markdown`'s `aside`, which only `remarkCallouts` makes: its title and its body, under an
 * icon, in the kind's tint. One that folds is a `<details>` — `-` shut, `+` open — so folding it is
 * the browser's and writes nothing. Any other `aside` is drawn as one.
 */
export function CalloutAside(props: AsideProps): ReactNode {
  const { node: _node, children, ...rest } = props;
  const word = rest["data-dag-callout-word"];
  if (word === undefined) return <aside {...rest}>{children}</aside>;
  const kind = calloutKind(word);
  const fold = rest["data-dag-callout-fold"];
  const [title, body] = Children.toArray(children).filter(isValidElement);
  const attrs = {
    id: rest.id,
    className: "dag-callout",
    "data-dag-callout": kind,
    "data-dag-callout-word": word,
    style: calloutVars(kind),
  };
  const head = (
    <>
      <CalloutIcon kind={kind} />
      {title}
    </>
  );
  if (fold === "-" || fold === "+")
    return (
      <details {...attrs} data-dag-callout-fold={fold} open={fold === "+"}>
        <summary className="dag-callout__head">
          {head}
          <span className="dag-callout__chevron" aria-hidden="true">
            <ChevronRight />
          </span>
        </summary>
        {body}
      </details>
    );
  return (
    <div {...attrs}>
      <div className="dag-callout__head">{head}</div>
      {body}
    </div>
  );
}
