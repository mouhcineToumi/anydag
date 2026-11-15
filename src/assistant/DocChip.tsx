import { File as FileGlyph, FileText, GraduationCap, LayoutDashboard, Table2, X, type LucideIcon } from "lucide-react";
import type { HTMLAttributes } from "react";

import { IconButton } from "@/ui/controls";

import type { DocKind } from "./types";

/* 12px inside a chip (DESIGN.md, *Icons*); 14px on the button that removes it. */
const MARK = { size: 12, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* Each kind's mark, keyed on the kind so a quiz is never drawn as a board — the references' set. */
const KIND_ICON = {
  board: LayoutDashboard,
  note: FileText,
  quiz: GraduationCap,
  table: Table2,
  file: FileGlyph,
} satisfies Record<DocKind, LucideIcon>;

/** A document a chat names: the one it works on (#323), and — next — the ones a message mentions with `@` (#324). */
export interface ChipDoc {
  kind: DocKind;
  name: string;
  title: string;
}

/**
 * One document, drawn as a chip in the composer: its kind's mark and its title, with its name in
 * the tooltip, and a button that removes it when the caller can. It knows nothing about what the
 * document is to the chat — the subject, a mention — so every chip a message carries is this one;
 * what the chip is for goes on it as a `data-dag-*` attribute from the caller.
 */
export function DocChip({
  doc,
  onRemove,
  removeLabel,
  ...rest
}: {
  doc: ChipDoc;
  /** Take the document off the message. No button when absent. */
  onRemove?: () => void;
  /** The remove button's name, where "Remove <title>" does not say what removing does. */
  removeLabel?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  const Mark = KIND_ICON[doc.kind];
  return (
    <span className="dag-chat-docchip" data-dag-chat-docchip={doc.kind} title={doc.name} {...rest}>
      <Mark {...MARK} aria-hidden="true" />
      <span className="dag-chat-docchip__title">{doc.title}</span>
      {onRemove ? (
        <IconButton
          size="sm"
          className="dag-chat-docchip__remove"
          data-dag-chat-docchip-remove=""
          aria-label={removeLabel ?? `Remove ${doc.title}`}
          onClick={onRemove}
        >
          <X {...ICON} aria-hidden="true" />
        </IconButton>
      ) : null}
    </span>
  );
}
