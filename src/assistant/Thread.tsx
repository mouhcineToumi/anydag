import { Check, ChevronRight, CircleAlert, FileText, Redo2, Shield, Undo2, Wrench } from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { refComponents, urlTransform } from "@/refs/Ref";

import type { Block, Mode, Step, Turn, UndoRecord } from "./types";
import { blockUndone } from "./types";
import { clock, conflictLines, oneLine, openable, targetOf, touched, undoable, verbOf, waiting } from "./words";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const PLUGINS = [remarkGfm];
/* One object for the page's life: these are component types to React, and a fresh set on every
   render would unmount every reference under them (`refComponents` says why). */
const MD = refComponents({ boards: false, placed: true });

/** The agent's words, as Markdown, with `dag:` citations drawn as the references they are. */
const Said = memo(function Said({ text }: { text: string }) {
  return (
    <div className="dag-md dag-chat-md" data-dag-chat-said="">
      <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={urlTransform} components={MD}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

/** What a harness is called to the person. */
export const providerLabel = (p: string): string => (p === "claude" ? "Claude Code" : p === "opencode" ? "OpenCode" : p);

/** A model's id with the vendor's prefix off, which is how a person says it. */
export const modelLabel = (id: string): string => id.replace(/^claude-/, "").replace(/^[a-z0-9-]+\//, "");

export interface Actions {
  /** The person's answer to an approval or an access card. */
  answer(step: string, yes: boolean): void;
  undo(turn: string, block: string, redo: boolean): void;
  open(kind: "board" | "note" | "quiz" | "table", name: string): void;
  /** Whether an undo or a redo is out, so a second press is not sent. */
  busy: boolean;
}

/** The newest undo or redo record of a block, which is what says whether it is undone and why not whole. */
function latestUndo(undos: readonly UndoRecord[], block: string): UndoRecord | undefined {
  let last: UndoRecord | undefined;
  for (const u of undos) if (u.block === block && (!last || u.id > last.id)) last = u;
  return last;
}

/** A tool call, folded to the one line it is — its verb and what it was about — and open to what went in and out. */
function ToolStep({ step, done }: { step: Extract<Step, { kind: "tool" }>; done: boolean }) {
  const target = targetOf(step.input);
  const running = !done && step.output === undefined;
  return (
    <details className="dag-chat-tool" data-dag-chat-tool={step.name} data-dag-chat-tool-state={step.error ? "error" : running ? "running" : "done"}>
      <summary title={oneLine(step.output)}>
        <ChevronRight className="dag-chat-tool__chev" {...ICON} aria-hidden="true" />
        <Wrench {...ICON} aria-hidden="true" />
        <span className="dag-chat-tool__verb">{verbOf(step.name, step.input)}</span>
        {target ? <span className="dag-chat-tool__target">{target}</span> : null}
        {step.error ? <span className="dag-chat-tool__flag">failed</span> : running ? <span className="dag-chat-tool__flag">working…</span> : null}
      </summary>
      <div className="dag-chat-tool__body">
        <span className="dag-chat-tool__label">Input</span>
        <pre>{JSON.stringify(step.input, null, 2)}</pre>
        {step.output !== undefined ? (
          <>
            <span className="dag-chat-tool__label">{step.error ? "Error" : "Output"}</span>
            <pre>{step.output}</pre>
          </>
        ) : null}
      </div>
    </details>
  );
}

const ANSWERED = { yes: "Allowed", no: "Denied", expired: "Expired — nothing was done" } as const;
const GRANTED = { yes: "Granted", no: "Not now", expired: "Expired — nothing was granted" } as const;

/** A write that is waiting for the person, or was answered. A turn that has ended cannot be answered any more. */
function ApprovalCard({ step, live, a }: { step: Extract<Step, { kind: "approval" }>; live: boolean; a: Actions }) {
  const answer = step.answer ?? (live ? null : "expired");
  return (
    <div className="dag-chat-card dag-chat-card--ask" role="group" aria-label="Approval needed" data-dag-chat-approval={step.id} data-dag-chat-answer={answer ?? "waiting"}>
      <Shield {...ICON} aria-hidden="true" />
      <div className="dag-chat-card__text">
        <strong>{step.what}</strong>
        {step.detail ? <span>{step.detail}</span> : null}
      </div>
      {answer === null ? (
        <div className="dag-chat-card__buttons">
          <button type="button" className="dag-button dag-button--primary" data-dag-chat-allow="" onClick={() => a.answer(step.id, true)}>
            Allow
          </button>
          <button type="button" className="dag-button" data-dag-chat-deny="" onClick={() => a.answer(step.id, false)}>
            Deny
          </button>
        </div>
      ) : (
        <span className="dag-chat-card__answer">{ANSWERED[answer]}</span>
      )}
    </div>
  );
}

/** The agent asking for another vault. Only the person's answer grants it. */
function AccessCard({ step, live, a }: { step: Extract<Step, { kind: "access" }>; live: boolean; a: Actions }) {
  const answer = step.answer ?? (live ? null : "expired");
  return (
    <div className="dag-chat-card dag-chat-card--ask" role="group" aria-label="Vault access requested" data-dag-chat-access={step.id} data-dag-chat-answer={answer ?? "waiting"}>
      <Shield {...ICON} aria-hidden="true" />
      <div className="dag-chat-card__text">
        <strong>
          Wants to {step.mode === "edit" ? "read and change" : "read"} <em>{step.name}</em>
        </strong>
        {step.why ? <span>{step.why}</span> : null}
      </div>
      {answer === null ? (
        <div className="dag-chat-card__buttons">
          <button type="button" className="dag-button dag-button--primary" data-dag-chat-grant="" onClick={() => a.answer(step.id, true)}>
            Grant
          </button>
          <button type="button" className="dag-button" data-dag-chat-notnow="" onClick={() => a.answer(step.id, false)}>
            Not now
          </button>
        </div>
      ) : (
        <span className="dag-chat-card__answer">{GRANTED[answer]}</span>
      )}
    </div>
  );
}

/** The files a block touched, each a link when it is a document the app opens. */
function Files({ block, open, max = 5 }: { block: Block; open(kind: "board" | "note" | "quiz" | "table", name: string): void; max?: number }) {
  const all = touched(block);
  const shown = all.slice(0, max);
  return (
    <ul className="dag-chat-files" data-dag-chat-files="">
      {shown.map((rel) => {
        const to = openable(rel);
        return (
          <li key={rel}>
            <FileText {...ICON} aria-hidden="true" />
            {to ? (
              <button type="button" className="dag-chat-files__open" data-dag-chat-file={rel} onClick={() => open(to.kind, to.name)} title={`Open ${to.name}`}>
                {rel}
              </button>
            ) : (
              <span data-dag-chat-file={rel}>{rel}</span>
            )}
          </li>
        );
      })}
      {all.length > shown.length ? <li className="dag-chat-files__more">and {all.length - shown.length} more</li> : null}
    </ul>
  );
}

/**
 * One block of changes: its title, the files it touched, and Undo — or Redo once it is undone. A
 * conflict is the files an undo left alone, which the next press of Undo would try again.
 *
 * `hook` says where it is drawn, since the thread and the Changes column both draw every block and a
 * button reached by one name would be two buttons.
 */
export function BlockCard({ turn, block, undos, a, hook }: { turn: string; block: Block; undos: readonly UndoRecord[]; a: Actions; hook: "block" | "change" }) {
  const undone = blockUndone(undos, block.id);
  const last = latestUndo(undos, block.id);
  const conflicts = last ? conflictLines(last) : [];
  const can = undoable(block);
  return (
    <div className="dag-chat-card dag-chat-card--block" data-dag-chat-block={block.id} data-dag-chat-block-state={undone ? "undone" : "done"} data-dag-chat-hook={hook}>
      <div className="dag-chat-card__text">
        <strong>{block.title || "Changes"}</strong>
        <Files block={block} open={a.open} />
        {conflicts.length ? (
          <ul className="dag-chat-conflicts" role="alert" data-dag-chat-conflicts="">
            {conflicts.map((c) => (
              <li key={c}>
                <CircleAlert {...ICON} aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="dag-chat-card__buttons">
        {undone ? <span className="dag-chat-card__answer">Undone</span> : null}
        {can ? (
          <button
            type="button"
            className="dag-button"
            {...{ [`data-dag-chat-${hook}-${undone ? "redo" : "undo"}`]: "" }}
            disabled={a.busy}
            onClick={() => a.undo(turn, block.id, undone)}
          >
            {undone ? <Redo2 {...ICON} aria-hidden="true" /> : <Undo2 {...ICON} aria-hidden="true" />}
            {undone ? "Redo" : "Undo"}
          </button>
        ) : (
          <span className="dag-chat-card__answer" title="Too big to have been kept">
            Cannot be undone
          </span>
        )}
      </div>
    </div>
  );
}

/** One turn: what was asked, who answered, what it did, what it said, and what it changed. */
const TurnView = memo(function TurnView({
  turn,
  live,
  typing,
  undos,
  elsewhere,
  a,
}: {
  turn: Turn;
  live: boolean;
  typing: string;
  undos: readonly UndoRecord[];
  /** Written on another machine, between two of this one's. */
  elsewhere: boolean;
  a: Actions;
}) {
  const body = useMemo(
    () =>
      turn.steps.map((s, i): ReactNode => {
        switch (s.kind) {
          case "text":
            return <Said key={i} text={s.text} />;
          case "tool":
            return <ToolStep key={s.id} step={s} done={!live} />;
          case "approval":
            return <ApprovalCard key={s.id} step={s} live={live} a={a} />;
          case "access":
            return <AccessCard key={s.id} step={s} live={live} a={a} />;
          case "error":
            return (
              <div key={i} className="dag-chat-error" role="alert" data-dag-chat-error="">
                <CircleAlert {...ICON} aria-hidden="true" />
                <span>{s.text}</span>
              </div>
            );
        }
      }),
    [turn.steps, live, a],
  );
  const asking = live && turn.steps.some(waiting);
  const effort = turn.effort ? ` · ${turn.effort}` : "";
  return (
    <section className="dag-chat-turn" data-dag-chat-turn={turn.id} data-dag-chat-status={live ? "running" : turn.status} data-dag-chat-elsewhere={elsewhere ? "" : undefined}>
      <div className="dag-chat-asked" data-dag-chat-asked="">
        <p>{turn.text}</p>
      </div>
      <header className="dag-chat-model" data-dag-chat-model="">
        <span>
          {providerLabel(turn.provider)} · {modelLabel(turn.model)}
          {effort}
        </span>
        <span className="dag-chat-model__mode" data-mode={turn.mode}>
          {turn.mode === "edit" ? "Edit" : "Ask"}
        </span>
        <time dateTime={turn.at}>{clock(turn.at)}</time>
        {elsewhere ? <span title="Written on another of your devices" className="dag-chat-model__elsewhere">another device</span> : null}
      </header>
      <div className="dag-chat-steps">
        {body}
        {live && typing ? <Said text={typing} /> : null}
        {live && !typing && !turn.steps.length ? (
          <p className="dag-chat-thinking" data-dag-chat-thinking="">
            Thinking…
          </p>
        ) : null}
        {live && !typing && turn.steps.length > 0 && !asking && turn.steps[turn.steps.length - 1]!.kind === "tool" ? (
          <p className="dag-chat-thinking" data-dag-chat-thinking="">
            Working…
          </p>
        ) : null}
      </div>
      {turn.blocks.map((b) => (
        <BlockCard key={b.id} turn={turn.id} block={b} undos={undos} a={a} hook="block" />
      ))}
      {!live && turn.status === "stopped" ? <p className="dag-chat-note">Stopped. What it wrote stays, and is above.</p> : null}
      {!live && turn.status === "failed" && !turn.steps.some((s) => s.kind === "error") ? <p className="dag-chat-note">That turn failed.</p> : null}
    </section>
  );
});

/** Every turn of a chat, in order, then the one running. */
export function Turns({ turns, live, typing, undos, device, a }: { turns: readonly Turn[]; live: Turn | null; typing: string; undos: readonly UndoRecord[]; device: string; a: Actions }) {
  return (
    <div className="dag-chat-turns" data-dag-chat-turns="">
      {turns.map((t, i) => (
        <TurnView key={t.id} turn={t} live={false} typing="" undos={undos} elsewhere={!!device && t.device !== device && i > 0 && turns.slice(0, i).some((p) => p.device === device)} a={a} />
      ))}
      {live ? <TurnView key={live.id} turn={live} live typing={typing} undos={undos} elsewhere={false} a={a} /> : null}
    </div>
  );
}

/** Shown when a chat has no turns yet. */
export function Empty({ mode }: { mode: Mode }) {
  return (
    <div className="dag-chat-empty" data-dag-chat-empty="">
      <Check {...ICON} aria-hidden="true" />
      <p>{mode === "edit" ? "Ask for a change, or a question. It can write in this vault, and every change can be undone." : "Ask a question about this vault. In Ask it reads and answers, and changes nothing."}</p>
    </div>
  );
}
