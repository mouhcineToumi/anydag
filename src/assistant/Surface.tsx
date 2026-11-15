import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AssistantError, answerStep, grantVault, makeChat, sayTurn, stopTurn, undoBlock } from "./api";
import { Composer, type Choice } from "./Composer";
import type { ChipDoc } from "./DocChip";
import type { MentionDoc } from "./mentions";
import { BlockCard, Empty, Turns, type Actions } from "./Thread";
import type { Mode } from "./types";
import { useChat, useModels } from "./useChat";

/**
 * One chat as a column: the thread, then the composer. The panel and the page both draw it, which is
 * what keeps them one chat in two sizes — the page adds a history on one side and the Changes on the
 * other, and the state is the same `useChat` either way.
 *
 * It does the sending, and with it the one thing a new chat needs: **the chat is made by its first
 * message**, from what the composer was showing, so nobody has to press New and then type.
 */
export function ChatSurface({
  id,
  chat,
  onId,
  onOpen,
  autofocus,
  changes,
  welcome,
  beside,
}: {
  id: string | null;
  chat: ReturnType<typeof useChat>;
  /** A chat now exists: the first message made it, or a grant did. */
  onId(id: string): void;
  onOpen(kind: "board" | "note" | "quiz" | "table", name: string): void;
  autofocus?: boolean;
  /** Draw the chat's blocks in a column of their own beside the thread — the page's, not the panel's. */
  changes?: boolean;
  /** A page with no chat yet: greet the person and centre the composer, rather than show an empty thread. */
  welcome?: boolean;
  /** The document open beside a panel: what a chat started here works on (#323). The page has none. */
  beside?: ChipDoc | null;
}) {
  const models = useModels();
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const idRef = useRef(id);
  idRef.current = id;
  useEffect(() => setNotice(null), [id]);

  /*
   * The chat's subject (#323): the document a chat started here works on, shown as a chip above
   * the field. A chat that exists says its own (`meta.subject`, which the server keeps); one that
   * does not yet is about the document open beside the panel. Removing the chip is said with the
   * next message — `subject: null`, the whole vault again — so it writes nothing on its own, and it
   * carries over the first message making the chat, which is why it is forgotten only on a move to
   * another chat, never on the move from none to the one just made.
   */
  const [dropped, setDropped] = useState(false);
  const was = useRef(id);
  useEffect(() => {
    if (was.current !== null && was.current !== id) setDropped(false);
    was.current = id;
  }, [id]);
  const kept = chat.meta?.subject ?? null;
  const subject: ChipDoc | null = dropped ? null : id ? kept : (beside ?? null);

  const say = (e: unknown) => setNotice(e instanceof AssistantError || e instanceof Error ? e.message : "that did not work");

  /** The chat the composer is talking to, made if it is the first thing said or granted. */
  const ensure = useCallback(
    async (c: Choice): Promise<string> => {
      if (idRef.current) return idRef.current;
      const meta = await makeChat({
        provider: c.provider,
        model: c.model,
        ...(c.effort ? { effort: c.effort } : {}),
      });
      idRef.current = meta.id;
      onId(meta.id);
      return meta.id;
    },
    [onId],
  );

  const send = useCallback(
    async (text: string, c: Choice, mentions: readonly MentionDoc[]) => {
      setNotice(null);
      setSending(true);
      try {
        const fresh = idRef.current === null;
        const to = await ensure(c);
        /* A new chat names the document it was started on; an old one says only a change. */
        const about = fresh
          ? beside
            ? { subject: dropped ? null : { name: beside.name, kind: beside.kind } }
            : {}
          : dropped && kept
            ? { subject: null }
            : {};
        await sayTurn({
          id: to,
          text,
          provider: c.provider,
          model: c.model,
          effort: c.effort || null,
          ...about,
          ...(mentions.length ? { mentions: mentions.map((m) => ({ name: m.name, kind: m.kind })) } : {}),
        });
      } catch (e) {
        say(e);
      } finally {
        setSending(false);
      }
    },
    [ensure, beside, dropped, kept],
  );

  const grant = useCallback(
    async (c: Choice, vault: string, mode: Mode | null) => {
      try {
        const to = await ensure(c);
        await grantVault(to, vault, mode);
      } catch (e) {
        say(e);
      }
    },
    [ensure],
  );

  const running = sending || chat.live !== null;
  const actions = useMemo<Actions>(
    () => ({
      /* Not while a turn is running either: the server refuses an undo until it has finished. */
      busy: busy || running,
      open: onOpen,
      answer: (step, yes) => {
        const to = idRef.current;
        if (to) void answerStep(to, step, yes).catch(say);
      },
      undo: (turn, block, redo) => {
        const to = idRef.current;
        if (!to) return;
        setBusy(true);
        setNotice(null);
        undoBlock(to, turn, block, redo)
          .catch(say)
          .finally(() => {
            setBusy(false);
            chat.reload();
          });
      },
    }),
    // `chat.reload` is stable; `chat` itself is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, running, onOpen, chat.reload],
  );

  /* Follow the end of the thread, unless the person has scrolled up to read: a reply is written
     under their eyes and a view that fights them for it is worse than one that does not follow. */
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = chat.turns[chat.turns.length - 1]?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [last, chat.live, chat.typing, chat.turns.length, id]);
  useEffect(() => {
    pinned.current = true;
  }, [id]);

  const meta = chat.meta;
  const empty = chat.turns.length === 0 && !chat.live;
  const first = welcome && empty;
  /* Newest first: what was just done is what somebody has come to undo. */
  const blocks = [...chat.turns, ...(chat.live ? [chat.live] : [])]
    .flatMap((t) => t.blocks.map((block) => ({ turn: t.id, block })))
    .reverse();
  const noticeLine = notice ? (
    <p className="dag-chat-error dag-chat-error--inline" role="alert" data-dag-chat-notice="">
      {notice}
    </p>
  ) : null;
  const composer = (
    <Composer
      meta={meta}
      models={models}
      running={running}
      autofocus={autofocus}
      onSend={(t, c, m) => void send(t, c, m)}
      onStop={() => id && void stopTurn(id).catch(say)}
      onGrant={(c, v, m) => void grant(c, v, m)}
      subject={subject}
      onDropSubject={() => setDropped(true)}
    />
  );
  const column = (
    <div
      className={first ? "dag-chat dag-chat--welcome" : "dag-chat"}
      data-dag-chat={id ?? "new"}
      data-dag-chat-running={running ? "" : undefined}
    >
      {first ? (
        <div className="dag-chat-welcome" data-dag-chat-welcome="">
          <h1 className="dag-chat-welcome__title">What can I help you with?</h1>
          <p className="dag-chat-welcome__line">
            {subject ? `Ask about “${subject.title}”, or ask for a change.` : "Ask about this vault, or ask for a change."}
          </p>
          {noticeLine}
          {composer}
        </div>
      ) : (
        <>
          <div
            className="dag-chat__scroll"
            ref={scroller}
            data-dag-chat-scroll=""
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {empty ? (
              <Empty />
            ) : (
              <Turns
                turns={chat.turns}
                live={chat.live}
                typing={chat.typing}
                undos={chat.undos}
                device={chat.device}
                a={actions}
              />
            )}
          </div>
          {noticeLine}
          {composer}
        </>
      )}
    </div>
  );
  /* A page with no chat yet has nothing to change, and a Changes column beside a greeting is furniture. */
  if (!changes || first) return column;
  return (
    <div className="dag-chat-with-changes">
      {column}
      <aside className="dag-chat-changes" aria-label="Changes" data-dag-chat-changes="">
        <h2>Changes</h2>
        {blocks.length ? (
          blocks.map(({ turn, block }) => (
            <BlockCard key={block.id} turn={turn} block={block} undos={chat.undos} a={actions} hook="change" />
          ))
        ) : (
          <p className="dag-chat-changes__none" data-dag-chat-changes-none="">
            Nothing changed yet. Each change the Assistant makes is listed here, and can be undone.
          </p>
        )}
      </aside>
    </div>
  );
}
