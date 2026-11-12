import { FileText, Home, RotateCcw, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { assertNever, type LoadProblem } from "@/board/useBoard";

/** The document kinds this card stands in for. A file attachment has a page of its own. */
export type FileProblemKind = "board" | "note" | "quiz" | "table";

/** The five ways forward a load problem can offer. */
type FileProblemAction = "search" | "trash" | "home" | "retry" | "text";

export interface FileProblemCopy {
  title: string;
  body: string;
  actions: FileProblemAction[];
}

/** The noun a person calls each kind, in the missing sentence. */
const NOUN: Record<FileProblemKind, string> = {
  board: "board",
  note: "note",
  quiz: "quiz",
  table: "table",
};

const quoted = (name: string) => `\u201c${name}\u201d`;

/**
 * What the card says, and what a person can do about it.
 *
 * **A reason, not a sentence from the server**: the server's message is for the Details disclosure,
 * because it names a route, a code or `Failed to fetch` — a fact about the transport rather than a
 * next step. The three reasons are the whole vocabulary:
 *
 * - **missing** is a 404 (or a file the feed watched go): search for it, look in the trash, or go home.
 * - **unreachable** is a `fetch` that rejected: the server is not answering, and the file is safe.
 * - **unreadable** is anything else: the file exists, but its bytes did not become the page. Where
 *   the text arrived, *Open as text* is how a person can still read or copy it.
 */
export function fileProblemCopy(kind: FileProblemKind, name: string, problem: LoadProblem): FileProblemCopy {
  switch (problem.reason) {
    case "missing":
      return {
        title: `There's no ${NOUN[kind]} called ${quoted(name)}`,
        body: "It may have been renamed, moved or trashed.",
        actions: ["search", "trash", "home"],
      };
    case "unreachable":
      return {
        title: `Couldn't open ${quoted(name)}`,
        body: "AnyDag's server isn't answering. The file is safe on disk.",
        actions: ["retry"],
      };
    case "unreadable":
      return {
        title: `Couldn't open ${quoted(name)}`,
        body: "The file is there, but AnyDag couldn't read it.",
        actions: [...(problem.text !== undefined ? (["text"] as const) : []), "home"],
      };
    default:
      return assertNever(problem.reason);
  }
}

const ICON = { size: 15, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The one card a page draws when the file it asked for could not be loaded — a board, note, quiz or
 * table. It replaces the DSL error card a board used to be drawn with, and the one-line notice a
 * note used to say: neither named the next step, and both left the top bar naming a file that was
 * not open.
 *
 * **Details for a bug report is closed, always.** The code and the raw message are what an issue
 * wants and what a person should not have to read to understand what happened; the title, the
 * sentence and the actions are the page. Nothing outside the disclosure names a code.
 *
 * **Open as text** exists only when the file's bytes arrived and the failure was in reading them as
 * this kind of document (`LoadProblem.text`). It is a read-only view of those bytes, to copy out of
 * or to see what a parser refused.
 */
export function FileProblem({
  kind,
  name,
  problem,
  onSearch,
  onTrash,
  onHome,
  onRetry,
}: {
  kind: FileProblemKind;
  name: string;
  problem: LoadProblem;
  onSearch?(): void;
  onTrash?(): void;
  onHome?(): void;
  onRetry?(): void;
}) {
  const copy = fileProblemCopy(kind, name, problem);
  const [textOpen, setTextOpen] = useState(false);

  const acts: Record<FileProblemAction, { label: string; icon: typeof Search; onClick?: () => void }> = {
    search: { label: "Search for it", icon: Search, onClick: onSearch },
    trash: { label: "Look in the trash", icon: Trash2, onClick: onTrash },
    home: { label: "Go home", icon: Home, onClick: onHome },
    retry: { label: "Try again", icon: RotateCcw, onClick: onRetry },
    text: {
      label: textOpen ? "Hide text" : "Open as text",
      icon: FileText,
      onClick: problem.text === undefined ? undefined : () => setTextOpen((open) => !open),
    },
  };

  return (
    <main className="dag-file-problem" data-dag-file-problem={problem.reason}>
      <section className="dag-file-problem__card" aria-labelledby="dag-file-problem-title">
        <h1 className="dag-file-problem__title" id="dag-file-problem-title">
          {copy.title}
        </h1>
        <p className="dag-file-problem__body">{copy.body}</p>
        <div className="dag-file-problem__acts">
          {copy.actions.map((action) => {
            const { label, icon: Icon, onClick } = acts[action];
            if (!onClick) return null;
            return (
              <button
                key={action}
                type="button"
                className="dag-file-problem__act"
                data-dag-file-problem-act={action}
                aria-expanded={action === "text" ? textOpen : undefined}
                onClick={onClick}
              >
                <Icon {...ICON} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        {textOpen && problem.text !== undefined ? (
          <pre className="dag-file-problem__text" data-dag-file-problem-text="" tabIndex={0}>
            {problem.text}
          </pre>
        ) : null}
        {problem.code || problem.message ? (
          <details className="dag-file-problem__details" data-dag-file-problem-details="">
            <summary>Details for a bug report</summary>
            <dl className="dag-file-problem__facts">
              {problem.code ? (
                <>
                  <dt>Code</dt>
                  <dd data-dag-file-problem-code="">{problem.code}</dd>
                </>
              ) : null}
              {problem.message ? (
                <>
                  <dt>Message</dt>
                  <dd data-dag-file-problem-message="">{problem.message}</dd>
                </>
              ) : null}
            </dl>
          </details>
        ) : null}
      </section>
    </main>
  );
}
