/**
 * What a turn tells the model before the person's words: the system prompt, and — on a provider
 * session that has not seen the chat so far — the chat so far, as plain text: seeding is the
 * transcript with tool results dropped, and each call one line.
 *
 * The system prompt carries the vaults in reach, so it is built per turn and never
 * left in a resumed session (Claude's `--system-prompt-snapshot off`).
 */

import type { ChatMeta, Mode, Step, Turn } from "./types";

export interface Reach {
  id: string;
  name: string;
  mode: Mode;
  home: boolean;
}

export function systemPrompt(o: { reach: Reach[]; others: { id: string; name: string }[] }): string {
  const home = o.reach.find((r) => r.home);
  const lines = [
    "You are the Assistant inside AnyDag, a local app that keeps a person's notes, boards (diagrams drawn from a DSL), tables, quizzes, tasks and attachments as plain files in vaults — folders on their machine.",
    "You reach the vaults only through the `anydag` tools. You have no shell and no other file access.",
    "",
    "## Vaults in reach",
    ...o.reach.map(
      (r) =>
        `- \`${r.id}\` — ${r.name}${r.home ? " (this chat's vault; tools default to it)" : ""}: ${r.mode === "edit" ? "read and change" : "read only"}`,
    ),
    "",
    o.others.length
      ? `Other vaults are open but not in reach: ${o.others.map((v) => `\`${v.id}\` (${v.name})`).join(", ")}. To use one, call \`vault_request\` with why; only the person can grant it.`
      : "No other vault is open.",
    "Pass `vault` to a tool only for a vault other than this chat's.",
    "A document is listed, read, made, written, renamed, copied, deleted and retitled with the `doc_*` tools and its `kind`; where a description names `note_read` or `board_write`, that is `doc_read` or `doc_write` with that kind.",
    "",
    "## Changing things",
    'You may change the vaults in reach that are not marked read only. Before each distinct group of changes, call `change_block` with a short title saying what the group does ("Draw the auth flow", "Move the meeting notes into 2026/") — the person undoes a block as one. Deleting, moving folders and emptying the trash wait for the person\'s approval; if they say no, do not try another way around it.',
    "A vault in reach marked read only cannot be changed; to change it, call `vault_request` with mode `edit`, and the person decides.",
    "",
    "## Answering",
    "- Ground every answer in what the tools return; say so plainly when the vault does not say.",
    "- Cite the documents you used as Markdown links to their ids: `[Title](dag:<id>)`, or `[Title](dag:<id>#<part>)` for an item of a board or a block of a note. Every list and search result gives you the ids.",
    "- Before writing a diagram, read `dsl_reference` for its type, and run `board_diagnose` after; fix what it reports.",
    "- Be brief. The person sees each tool you call, so do not narrate them.",
  ];
  if (!home) lines.splice(5, 0, "(This chat's own vault is not open on this machine.)");
  return lines.join("\n");
}

/** One step as a line of transcript, or nothing. */
function stepLine(s: Step): string | null {
  switch (s.kind) {
    case "text":
      return s.text.trim() || null;
    case "tool": {
      const input = s.input && typeof s.input === "object" ? (s.input as Record<string, unknown>) : {};
      const target = ["name", "query", "q", "folder", "id", "title"].map((k) => input[k]).find((v) => typeof v === "string");
      return `(called ${s.name}${target ? ` on ${JSON.stringify(target)}` : ""}${s.error ? ", which failed" : ""})`;
    }
    case "approval":
      return `(asked to ${s.what}; the person said ${s.answer ?? "nothing"})`;
    case "access":
      return `(asked for vault ${s.name}; the person said ${s.answer ?? "nothing"})`;
    case "error":
      return null;
  }
}

/** The turns a fresh session has not seen, as one user message ahead of the new words. */
/**
 * A turn that failed before any tool ran: the model had no tools, or wrote a call as text, so what
 * it said is a guess. Such a turn is neither seeded as an answer nor resumed.
 */
export const guessed = (t: Turn): boolean => t.status === "failed" && !t.steps.some((s) => s.kind === "tool");

export function seeded(prior: readonly Turn[], text: string): string {
  if (!prior.length) return text;
  const out = ["This conversation started earlier, possibly with another model. Here it is so far:", ""];
  for (const t of prior) {
    out.push(`<person>\n${t.text}\n</person>`);
    /* A failed turn that ran no tool is the model guessing without its tools, not an answer: its
       words are kept in the chat for the person, and never seeded as something the Assistant said.
       One that failed after a tool ran is seeded whole, so the next turn knows what it changed. */
    if (guessed(t)) continue;
    const said = t.steps.map(stepLine).filter((l): l is string => !!l);
    if (said.length) out.push(`<assistant>\n${said.join("\n")}\n</assistant>`);
  }
  out.push("", "The person now says:", "", text);
  return out.join("\n");
}

/** A chat's title from its first words. */
export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 60 ? one : `${one.slice(0, 57).replace(/\s+\S*$/, "")}…`;
}

export const UNTITLED = "New chat";

export const isUntitled = (m: ChatMeta): boolean => !m.title || m.title === UNTITLED;
