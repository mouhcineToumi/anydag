import { Check, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { currentVault } from "@/vault/current";
import { useVaults } from "@/vault/useVaults";

import { deleteChat, renameChat } from "./api";
import { ChatSurface } from "./Surface";
import type { ChatRow } from "./types";
import { useChat, useChats } from "./useChat";
import { dayLabel } from "./words";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What `?chat=` says: a chat's id, `new` for a blank one, or `1` for the newest the vault has. */
export const NEW_CHAT = "new";

/**
 * The Assistant page (`?chat=`): the history down the left, grouped by day, the chat in the middle,
 * and the Changes down the right. The same chat the panel shows, in the room a long conversation
 * wants — opening the page from the panel keeps it.
 *
 * With no chat yet it opens on a prompt in the middle of the page, the way an agent app does: one
 * composer to type into at once, a greeting, and no heading. The first message makes the chat and
 * the page becomes the ordinary thread with the composer at its foot.
 */
export function AssistantView({
  raw,
  onChat,
  onOpen,
}: {
  raw: string | null;
  onChat(id: string | null): void;
  onOpen(kind: "board" | "note" | "quiz" | "table", name: string): void;
}) {
  const chats = useChats();
  const vaults = useVaults();
  const here = currentVault();
  /* `1` is "wherever I was": the newest, or a blank one while the list is empty. It waits for the
     list rather than guessing, so a page opened on `?chat=1` does not flash a blank chat first. */
  const id = raw === NEW_CHAT ? null : raw === "1" || raw === null ? (chats.rows[0]?.id ?? null) : raw;
  const chat = useChat(id);
  const row = chats.rows.find((r) => r.id === id);
  const waiting = (raw === "1" || raw === null) && !chats.loaded;
  /* A chat deleted while this page is on it — here or in another tab — leaves for New chat, not a
     stale shell. */
  useEffect(() => {
    if (chat.gone) onChat(NEW_CHAT);
  }, [chat.gone, onChat]);
  const nameOf = (vault: string) => vaults?.find((v) => v.id === vault)?.name;

  return (
    <div className="dag-assistant" data-dag-assistant-page="">
      <History rows={chats.rows} loaded={chats.loaded} current={id} here={here} nameOf={nameOf} onPick={onChat} />
      <section className="dag-assistant__main">
        {id ? (
          <Heading
            id={id}
            title={chat.meta?.title ?? row?.title ?? ""}
            missing={chat.missing}
            running={chat.live !== null}
            onGone={() => onChat(NEW_CHAT)}
          />
        ) : null}
        {waiting || chat.gone ? null : chat.missing ? (
          <p className="dag-chat-empty" data-dag-chat-missing="">
            There is no chat with this id in this vault. It may have been deleted, or it may be in a vault that is not open.
          </p>
        ) : (
          <ChatSurface
            id={id}
            chat={chat}
            onId={(made) => onChat(made)}
            onOpen={onOpen}
            changes
            autofocus
            welcome={id === null}
          />
        )}
      </section>
    </div>
  );
}

/** The chats, a day at a time, newest first; the open one marked; a running one says so. */
function History({
  rows,
  loaded,
  current,
  here,
  nameOf,
  onPick,
}: {
  rows: ChatRow[];
  loaded: boolean;
  current: string | null;
  /** This tab's vault: a row from another open vault says so. */
  here: string;
  nameOf(vault: string): string | undefined;
  onPick(id: string | null): void;
}) {
  const groups = useMemo(() => {
    const out: { label: string; rows: ChatRow[] }[] = [];
    for (const r of rows) {
      const label = dayLabel(r.updated);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [rows]);
  return (
    <nav className="dag-assistant__history" aria-label="Chats" data-dag-chat-history="">
      <button type="button" className="dag-button dag-assistant__new" data-dag-chat-new="" onClick={() => onPick(NEW_CHAT)}>
        <MessageSquarePlus {...ICON} aria-hidden="true" />
        New chat
      </button>
      {groups.map((g) => (
        <section key={g.label} className="dag-assistant__day" data-dag-chat-day={g.label}>
          <h2>{g.label}</h2>
          {g.rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="dag-assistant__row"
              data-dag-chat-row={r.id}
              aria-current={r.id === current ? "page" : undefined}
              title={r.title}
              onClick={() => onPick(r.id)}
            >
              <span className="dag-assistant__rowtitle">{r.title}</span>
              {r.vault !== here ? (
                <span className="dag-assistant__rowvault" data-dag-chat-row-vault={r.vault}>
                  {nameOf(r.vault) ?? "Another vault"}
                </span>
              ) : null}
              {r.running ? <span className="dag-assistant__live" aria-label="answering" data-dag-chat-row-running="" /> : null}
            </button>
          ))}
        </section>
      ))}
      {loaded && !rows.length ? (
        <p className="dag-assistant__none" data-dag-chat-history-none="">
          No chats yet.
        </p>
      ) : null}
    </nav>
  );
}

/** The chat's title, which is a field when pressed, and the delete that asks first. */
function Heading({
  id,
  title,
  missing,
  running,
  onGone,
}: {
  id: string | null;
  title: string;
  missing: boolean;
  running: boolean;
  onGone(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setEditing(false);
    setSure(false);
    setProblem(null);
  }, [id]);
  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    if (id && next && next !== title) void renameChat(id, next).catch((e: Error) => setProblem(e.message));
  };
  return (
    <header className="dag-assistant__head">
      {editing ? (
        <input
          ref={field}
          className="dag-assistant__title-field"
          data-dag-chat-title-field=""
          aria-label="Chat title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h1
          className="dag-assistant__title"
          data-dag-chat-title=""
          onDoubleClick={() => id && (setDraft(title), setEditing(true))}
        >
          {id ? title || "Untitled chat" : "New chat"}
        </h1>
      )}
      {id && !missing && !editing ? (
        <button
          type="button"
          className="dag-icon"
          data-dag-chat-rename=""
          aria-label="Rename the chat"
          title="Rename the chat"
          onClick={() => (setDraft(title), setEditing(true))}
        >
          <Pencil {...ICON} aria-hidden="true" />
        </button>
      ) : null}
      <span className="dag-assistant__space" />
      {problem ? (
        <span className="dag-assistant__problem" role="alert">
          {problem}
        </span>
      ) : null}
      {id && !missing ? (
        sure ? (
          <span className="dag-assistant__sure" data-dag-chat-delete-sure="">
            Delete this chat?
            <button
              type="button"
              className="dag-button dag-button--danger"
              data-dag-chat-delete-confirm=""
              onClick={() =>
                void deleteChat(id).then(onGone, (e: Error) => {
                  setProblem(e.message);
                  setSure(false);
                })
              }
            >
              <Check {...ICON} aria-hidden="true" />
              Delete
            </button>
            <button type="button" className="dag-icon" aria-label="Keep it" onClick={() => setSure(false)}>
              <X {...ICON} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="dag-icon"
            data-dag-chat-delete=""
            aria-label="Delete the chat"
            title={running ? "Stop it first" : "Delete the chat"}
            disabled={running}
            onClick={() => setSure(true)}
          >
            <Trash2 {...ICON} aria-hidden="true" />
          </button>
        )
      ) : null}
    </header>
  );
}
