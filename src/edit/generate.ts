import type { AttrValue } from "@/board/attrs";
import type { PatchOp } from "@/board/patch";
import type { BoardItem, DiagramType } from "@/board/types";

/**
 * A prompt card's two halves that have no pointer in them: asking the dev server for a diagram, and
 * what putting the answer where the card was *means* as an edit.
 *
 * The gesture is in `useEditor` (`ctl.generate`) and the card is `PromptItem`; this file is what
 * makes the replacement testable without a browser, the way `build.ts` is for the `+`.
 */

/** A diagnostic about the draft, `line` counted from the first line inside its fence (0 = the fence line). */
export interface DraftDiagnostic {
  line: number;
  col?: number;
  code: string;
  message: string;
  severity: "error" | "warn";
}

export interface Draft {
  type: DiagramType;
  attrs: Record<string, AttrValue>;
  body: string;
}

/** The body of `POST /__board/generate` — `plugins/generate/generate.ts` plus who answered. */
export interface Generated {
  ok: boolean;
  draft?: Draft;
  diagnostics: DraftDiagnostic[];
  attempts: number;
  error?: string;
  provider?: string;
  model?: string;
  reasoning?: string;
  ms?: number;
}

export interface GenerateRequest {
  prompt: string;
  as?: DiagramType;
  provider?: string | null;
  model?: string | null;
  /** How hard to think, when the settings card has asked for a particular level. */
  reasoning?: string | null;
  /**
   * The body being rewritten, when this is a rewrite rather than a fresh draw. The server reads it
   * (`plugins/board.ts`'s `/generate`), and `requestDiagram` forwards it as it forwards everything
   * else — which is the whole reason this field is here rather than in a second request type.
   */
  source?: string;
  /**
   * The rewritten item's type now. A rewrite used to send it as `as`, which pinned it, so asking
   * for "another diagram type" was an `EG_WRONG_TYPE` on every attempt; the model keeps
   * this type unless the change asks for a different kind of diagram.
   */
  from?: DiagramType;
}

/**
 * Ask for a diagram. A refusal the server explains — no key, a prompt too long, the provider down —
 * is thrown as an `Error` carrying that explanation, which is what the card shows.
 */
export async function requestDiagram(req: GenerateRequest, signal?: AbortSignal): Promise<Generated> {
  const res = await fetch("/__board/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<Generated> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `the server answered ${res.status}`);
  return { diagnostics: [], attempts: 0, ok: false, ...body };
}

/**
 * The edit that swaps a card for its diagram: one insert right after the card and the card removed,
 * in one patch — so one history entry, and one ctrl+Z brings the card back with its text.
 *
 * The diagram takes the card's place in every sense the file can state: its `x`/`y` when the card
 * had them (an unpinned card stays unpinned, and the flow puts the diagram where it put the card),
 * its page and its group as *written* — not `item.page`, which is derived and says `page-1` for a
 * card that never named one — and its position in the stack, since it is inserted right after it.
 * Not its width: a card's `w=` is a text box's, and on a diagram `w=` widens the frame and leaves
 * the content where it was.
 */
export function replacement(card: BoardItem, draft: Draft, id: string): PatchOp[] {
  const written = card.attrs.map;
  const attrs: Record<string, AttrValue> = { id, ...draft.attrs };
  for (const key of ["x", "y", "page", "group"] as const) {
    const v = written[key];
    if (v !== undefined) attrs[key] = v;
  }
  return [
    { insert: { type: draft.type, attrs, body: draft.body }, after: card.id },
    { id: card.id, remove: true },
  ];
}
