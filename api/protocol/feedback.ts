/**
 * Feedback: what a person may send to the project's issue tracker, and the limits every hop holds.
 *
 * Read by the three places a submission passes — the page's card (`src/feedback/`), the app's
 * server that forwards it (`server/feedback.ts`), and the relay that turns it into a GitHub issue
 * (`api/server/routes/feedback.ts`). Each checks the same caps, so a sender somebody wrote by hand
 * is refused by the relay with the sentence the card would have shown.
 *
 * Load-bearing:
 * - **Feedback is not telemetry.** It is sent only by a person pressing Send (or an agent the person
 *   asked, through the MCP `feedback` tool), it carries their own words, and it is public once it
 *   lands. `logs.ts`'s vocabulary has nothing to do with it, and it never rides a log batch.
 * - **What leaves is exactly what the card lists**: the kind, the text, each file by name, the whole
 *   text of each board or note that was ticked, and `env` — the version, the system and the arch.
 *   Nothing else; no install id, no vault, no path.
 * - **Plain TypeScript, no imports**, `wire.ts`'s rule: the page, the app's server and the relay
 *   take it verbatim.
 */

const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Every file together, and the board and note text with them: the relay buffers one request. */
export const MAX_FEEDBACK_BYTES = 10 * 1024 * 1024;
export const MAX_FEEDBACK_FILES = 5;
/** The person's own words. */
const MAX_FEEDBACK_TEXT = 20_000;
/** One board or note's text, and how many of them. */
const MAX_FEEDBACK_DOC = 200_000;
const MAX_FEEDBACK_DOCS = 5;
/** A file's or a document's name. */
const MAX_FEEDBACK_NAME = 200;

/** The kinds of file GitHub draws or links, and nothing that runs. */
function feedbackMime(type: string): boolean {
  const t = type.toLowerCase().split(";")[0]!.trim();
  return /^(image|video|text)\/[a-z0-9.+-]+$/.test(t) || t === "application/pdf";
}

/** Where the submission came from: what the card says it sends, and only that. */
export interface FeedbackEnv {
  version: string;
  os: string;
  arch: string;
}

/** A board or a note that was ticked: its name and its whole text. */
export interface FeedbackDoc {
  name: string;
  text: string;
}

/** The relay's answer to a submission that became an issue. */
export interface FeedbackSent {
  url: string;
}

/**
 * What is wrong with a submission, as the sentence a person reads, or `null` when it may go. The
 * files are described by name, type and size, which is all a cap needs.
 */
export function feedbackProblem(s: {
  kind: unknown;
  text: unknown;
  boards: readonly FeedbackDoc[];
  notes: readonly FeedbackDoc[];
  files: readonly { name: string; type: string; size: number }[];
}): string | null {
  if (!FEEDBACK_KINDS.includes(s.kind as FeedbackKind)) return "the kind is bug or idea";
  if (typeof s.text !== "string" || !s.text.trim()) return "say what happened, or what you would like";
  if (s.text.length > MAX_FEEDBACK_TEXT) return `the text is longer than ${MAX_FEEDBACK_TEXT} characters`;
  const docs = [...s.boards, ...s.notes];
  if (docs.length > MAX_FEEDBACK_DOCS) return `at most ${MAX_FEEDBACK_DOCS} boards and notes`;
  for (const d of docs) {
    if (!d.name || d.name.length > MAX_FEEDBACK_NAME) return "a board or note has no name, or too long a one";
    if (d.text.length > MAX_FEEDBACK_DOC) return `\`${d.name}\` is longer than ${MAX_FEEDBACK_DOC} characters`;
  }
  if (s.files.length > MAX_FEEDBACK_FILES) return `at most ${MAX_FEEDBACK_FILES} files`;
  let total = docs.reduce((n, d) => n + d.text.length, s.text.length);
  for (const f of s.files) {
    if (!f.name || f.name.length > MAX_FEEDBACK_NAME) return "a file has no name, or too long a one";
    if (!feedbackMime(f.type)) return `\`${f.name}\` is not a picture, a video, a PDF or a text file`;
    total += f.size;
  }
  if (total > MAX_FEEDBACK_BYTES) return `everything together is more than ${MAX_FEEDBACK_BYTES / 1024 / 1024} MB`;
  return null;
}
