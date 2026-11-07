import type { AttrValue } from "../../src/board/attrs";
import { serializeAttrs } from "../../src/board/attrs";
import { renderFence } from "../../src/board/locate";
import { parseBoard } from "../../src/board/parseBoard";
import { withId } from "../../src/board/patch";
import { DIAGRAM_TYPES, isDiagramType, type BoardItem, type DiagramType } from "../../src/board/types";
import { CODES, type Code } from "../../src/dsl/codes";
import type { Diagnostic } from "../../src/dsl/ir";
import { parseItem } from "../../src/dsl/diagnose";
import type { Complete, Message } from "./llm";

/**
 * A prompt in, one checked diagram out — or the closest thing to one, with what is wrong with it.
 *
 * The loop is the skill's fix loop with a model on the other end instead of Claude: ask, find the
 * fence, parse it with the real parser, and if anything is wrong send back the diagnostics and ask
 * for the whole block again. It branches on **codes**, never on message text, for the reason every
 * other fix loop here does — a message is written for a person and may be reworded.
 *
 * Nothing here writes a board. The client puts the result where the card was, in one commit, so
 * that ctrl+Z brings the card back; a server-side write would arrive at the page as somebody else's
 * edit and drop the undo stack.
 */

/** What goes into the board: a fence's type, its allowed attributes, and its body. */
export interface Draft {
  type: DiagramType;
  attrs: Record<string, AttrValue>;
  body: string;
}

/** A diagnostic about the draft, with `line` counted from the body's first line (0 = the fence line). */
export type DraftDiagnostic = Diagnostic;

export interface GenerateResult {
  /** True when the best draft has no error. Warnings may remain. */
  ok: boolean;
  draft?: Draft;
  diagnostics: DraftDiagnostic[];
  attempts: number;
  /** Set when no attempt produced a diagram fence at all — there is nothing to insert, even anyway. */
  error?: string;
}

export interface GenerateOptions {
  prompt: string;
  /** The fence body being rewritten. When present the run is a rewrite, not a fresh draw. */
  source?: string;
  /**
   * What the rewritten item is now. A rewrite used to pin `as` to it, so "show the same thing as a
   * flowchart" came back as an `EG_WRONG_TYPE` error on every attempt and the item could not change
   * type at all. The type is the model's to change when the person asks for another kind
   * of diagram, and `from` is how it is told what it is changing from.
   */
  from?: DiagramType;
  as?: DiagramType;
  system: string;
  complete: Complete;
  /** How many times the model is asked, first try included. */
  attempts?: number;
  signal?: AbortSignal;
}

/**
 * Warnings worth another round trip, because each is a word the model got wrong rather than a
 * judgement about the drawing. A `W_CHART_MANY` is a design choice the doctrine argues with and
 * the author may well have meant; an unknown icon is a typo.
 */
const FIXABLE: ReadonlySet<Code> = new Set<Code>([
  CODES.W_UNKNOWN_ICON,
  CODES.W_UNKNOWN_HUE,
  CODES.W_UNKNOWN_ATTR,
  CODES.W_RETIRED_FLAG,
  /* An edge from a row the card does not have — the first live round found GLM writing
     `index.generate` for a row it had only given the API. It draws, from the wrong place. */
  CODES.W_MISSING_ROW,
  CODES.W_CHART_LENGTH,
  CODES.W_CHART_EMPTY,
]);

/** The fence attributes a model may set. Where the diagram goes is the card's, never the model's.
 *  In rewrite mode the placement is the *item's*: the caller overlays the target item's own attrs
 *  (its `x`, `y`, `page`, `group` and id) onto the answer — the client does that, not the server. */
const ALLOWED = ["title", "subtitle", "dir", "aspect", "frame"];
const SIZED: ReadonlySet<string> = new Set(["chart", "sketch"]);

function allowed(type: DiagramType, item: BoardItem): Record<string, AttrValue> {
  const keys = SIZED.has(type) ? [...ALLOWED, "w", "h"] : ALLOWED;
  const out: Record<string, AttrValue> = {};
  for (const k of item.attrs.order) if (keys.includes(k) && item.attrs.map[k] !== undefined) out[k] = item.attrs.map[k]!;
  return out;
}

/** The draft as a board file of one fence — the exact text that will be inserted, parsed as such. */
export const fenceOf = (d: Draft): string => renderFence(d.type, serializeAttrs(withId(d.attrs, "draft")), d.body);

/**
 * Check a draft the way the page will: the fence line through `parseBoard`, the body through the
 * dialect's parser — `parseItem` being the one place that says which parser a type takes and with
 * which arguments, shared with the page and the `/diagnostics` route.
 *
 * Lines come back relative to the body, which is the only thing a model can act on: it never saw a
 * board file, and every line number it is sent counts from inside its own fence.
 */
export function check(d: Draft): DraftDiagnostic[] {
  const board = parseBoard("draft", fenceOf(d));
  const item = board.items.find((it) => it.id === "draft");
  const fence = board.errors.map((e) => ({ ...e, line: 0 }));
  if (!item) return fence;
  return [...fence, ...(parseItem(item)?.diagnostics ?? [])];
}

type Found = { draft: Draft } | { none: string };

/** A body with its trailing whitespace gone — per line, then the whole — the form two bodies are compared in. */
export const normalizedBody = (body: string): string => body.replace(/[ \t]+$/gm, "").replace(/\s+$/, "");

/** True when a draft's body says exactly what the source says — the model has echoed, not rewritten. */
export const echoesSource = (body: string, source: string): boolean => normalizedBody(body) === normalizedBody(source);

/**
 * The diagram fence in a reply, whatever the model wrapped around it.
 *
 * In rewrite mode the chosen fence is the **last** one, and one that says exactly what it was given
 * is refused — because a model asked to rewrite often quotes the original before giving its
 * corrected version. The first fence would then extract the *original*, which checks clean and ends
 * the loop on attempt one having silently replaced the diagram with itself: a defect with no
 * symptom, since every check passes and the reply looks like a success. Fresh-draw mode keeps the
 * first fence, which it always took.
 */
export function extract(reply: string, as?: DiagramType, source?: string): Found {
  /* A reply wrapped whole in a longer fence — ````markdown around the ```arch — is unwrapped first:
     the board format reads three backticks, so the outer fence would be an unknown type and the
     diagram inside it prose. */
  const outer = /^\s*(`{4,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(reply);
  const board = parseBoard("reply", outer ? outer[2]! : reply);
  const diagrams = board.items.filter((it) => isDiagramType(it.type));
  const item = source === undefined ? diagrams[0] : diagrams[diagrams.length - 1];
  if (item && isDiagramType(item.type)) {
    const draft = { type: item.type, attrs: allowed(item.type, item), body: item.body.replace(/\s+$/, "") };
    if (source !== undefined && echoesSource(draft.body, source))
      return {
        none: "You returned the diagram unchanged. Make the change the person asked for and answer with the whole corrected block.",
      };
    return { draft };
  }
  const foreign = board.errors.find((e) => e.code === CODES.EB_UNKNOWN_TYPE);
  const said = foreign
    ? ` Your reply opened a fence with ${foreign.message.replace(/^unknown item type /, "")}, which is not one of them.`
    : "";
  return {
    none: `I could not find a diagram in your reply.${said} Answer with exactly one fenced block whose info word is ${as ? `\`${as}\`` : `one of ${DIAGRAM_TYPES.map((t) => `\`${t}\``).join(", ")}`}.`,
  };
}

const errorsIn = (ds: DraftDiagnostic[]) => ds.filter((d) => d.severity === "error").length;
const fixableIn = (ds: DraftDiagnostic[]) => ds.filter((d) => d.severity === "warn" && FIXABLE.has(d.code)).length;
const warningsIn = (ds: DraftDiagnostic[]) => ds.filter((d) => d.severity === "warn").length;

/** Fewer errors wins, then fewer warnings. */
const better = (a: DraftDiagnostic[], b: DraftDiagnostic[]) => errorsIn(a) - errorsIn(b) || warningsIn(a) - warningsIn(b);

/** What the model is told about its last answer: every problem, one line each, with its code. */
export function feedback(ds: DraftDiagnostic[], wrongType?: { want: DiagramType; got: DiagramType }): string {
  const lines = ds
    .filter((d) => d.severity === "error" || FIXABLE.has(d.code))
    .map((d) => `- ${d.line === 0 ? "fence line" : `line ${d.line}${d.col ? `:${d.col}` : ""}`} ${d.code} — ${d.message}`);
  if (wrongType) lines.unshift(`- the fence is \`${wrongType.got}\`, but the person asked for \`${wrongType.want}\``);
  return [
    "AnyDag's parser reported these problems with your diagram (line numbers count from the first line inside the fence):",
    "",
    ...lines,
    "",
    "Fix every one of them and answer with the whole corrected block — one fence, nothing after it.",
  ].join("\n");
}

/** The first user turn. It starts with a word, never with the description, so a CLI never reads it as a flag. */
export const request = (prompt: string, as?: DiagramType): string =>
  `Draw this${as ? ` as a \`${as}\` diagram` : ""}:\n\n${prompt.trim()}`;

/**
 * The rewrite turn: the current DSL first, then the change. It starts with a word for the same
 * reason `request` does, and says plainly that the answer is the whole new body — the loop checks
 * and replaces a whole body, and a diff or a fragment is nothing it can land.
 */
export const rewriteRequest = (prompt: string, source: string, as?: DiagramType, from?: DiagramType): string =>
  `Rewrite the ${from && !as ? `\`${from}\` ` : ""}diagram below${as ? ` — it stays a \`${as}\`` : ""}. Answer with the whole new body in one fence, keeping every id you are not asked to change. ${
    as
      ? "Keep the fence's type."
      : from
        ? `Keep it a \`${from}\` unless the change asks for a different kind of diagram; then answer in the type that fits and carry over everything it says.`
        : "Keep the fence's type unless the change asks for a different kind of diagram."
  }\n\nThe diagram's current DSL:\n\n${source.trim()}\n\nThe change to make:\n\n${prompt.trim()}`;

export async function generate(o: GenerateOptions): Promise<GenerateResult> {
  const max = Math.max(1, o.attempts ?? 3);
  const messages: Message[] = [
    { role: "system", content: o.system },
    {
      role: "user",
      content: o.source === undefined ? request(o.prompt, o.as) : rewriteRequest(o.prompt, o.source, o.as, o.from),
    },
  ];

  let best: { draft: Draft; diagnostics: DraftDiagnostic[] } | undefined;
  let lastNone = "";
  let used = 0;

  for (let n = 1; n <= max; n++) {
    o.signal?.throwIfAborted();
    used = n;
    const reply = await o.complete(messages, o.signal);
    const found = extract(reply, o.as, o.source);

    if ("none" in found) {
      lastNone = found.none;
      if (n < max) messages.push({ role: "assistant", content: reply }, { role: "user", content: found.none });
      continue;
    }

    const diagnostics = check(found.draft);
    const wrongType = o.as && found.draft.type !== o.as ? { want: o.as, got: found.draft.type } : undefined;
    /* A diagram of the wrong type is still a diagram, and may be the best one there is; it just
       counts as an error, so it never wins over a draft that is what was asked for. */
    const scored = wrongType
      ? [
          {
            line: 0,
            code: CODES.EG_WRONG_TYPE,
            message: `asked for \`${o.as}\`, drew \`${found.draft.type}\``,
            severity: "error" as const,
          },
          ...diagnostics,
        ]
      : diagnostics;

    if (!best || better(scored, best.diagnostics) < 0) best = { draft: found.draft, diagnostics: scored };
    if (errorsIn(scored) === 0 && fixableIn(scored) === 0) break;
    if (n < max)
      messages.push({ role: "assistant", content: reply }, { role: "user", content: feedback(diagnostics, wrongType) });
  }

  if (!best) return { ok: false, diagnostics: [], attempts: used, error: lastNone || "the model gave no answer" };
  return { ok: errorsIn(best.diagnostics) === 0, draft: best.draft, diagnostics: best.diagnostics, attempts: used };
}
