import { ExternalLink, MessageCircleWarning, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import {
  feedbackProblem,
  MAX_FEEDBACK_FILES,
  type FeedbackEnv,
  type FeedbackKind,
  type FeedbackSent,
} from "../../api/protocol/feedback";
import { Dialog } from "@/ui/Dialog";

const ICON = { size: 16, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The board or note open behind the card, which a tick attaches whole. */
export interface FeedbackDocument {
  kind: "board" | "note";
  /** The vault's name for it, which the server reads. */
  name: string;
}

interface Draft {
  kind: FeedbackKind;
  text: string;
  files: File[];
  attach: boolean;
}

const EMPTY: Draft = { kind: "bug", text: "", files: [], attach: false };

/**
 * The draft outlives the card: closing it, or a send that failed, leaves what was written for the
 * next time it opens. Only a send that became an issue clears it. One per tab, in memory.
 */
let kept: Draft = EMPTY;

interface Status {
  destination: string | null;
  env: FeedbackEnv;
}

type Sending = { state: "idle" } | { state: "sending" } | { state: "sent"; url: string } | { state: "failed"; error: string };

const leaf = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const fileName = (d: FeedbackDocument) => `${leaf(d.name)}.${d.kind}.md`;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => reject(r.error ?? new Error(`could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** A pasted picture has no name worth keeping: give it one with the time it was taken. */
function named(f: File): File {
  if (f.name && f.name !== "image.png") return f;
  const ext = f.type.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "png";
  const at = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return new File([f], `pasted-${at}.${ext}`, { type: f.type });
}

/**
 * Send feedback: a bug or an idea, with files and, ticked, the board or note behind it — made a
 * public GitHub issue by the relay (`api/server/routes/feedback.ts`), through the app's server.
 *
 * Load-bearing:
 * - **It says exactly what leaves before anything does**: the text, each file by name, the whole
 *   text of the ticked board or note, and the version, system and arch the server reports
 *   (`GET /api/feedback`). Nothing is sent until Send; nothing else is sent at all.
 * - **A failed send keeps the draft**, and so does closing the card (`kept`).
 * - **A paste stays in it**: `useEditor` puts a pasted thing on the board, so the card stops paste
 *   on its way up — and takes a pasted picture as an attachment. Every other key stops here too:
 *   the board's keys must not act behind it (`data-dag-feedback` beside `data-dag-settings`).
 */
export function FeedbackCard({ document: doc, onClose }: { document: FeedbackDocument | null; onClose(): void }) {
  const [draft, setDraftState] = useState<Draft>(kept);
  const setDraft = (next: Draft) => {
    kept = next;
    setDraftState(next);
  };
  const [status, setStatus] = useState<Status | null | "failed">(null);
  const [sending, setSending] = useState<Sending>({ state: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    let live = true;
    fetch("/api/feedback")
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus("failed"));
    return () => {
      live = false;
    };
  }, []);

  const attached = doc && draft.attach ? doc : null;
  const add = (incoming: readonly File[]) => {
    const files = [...draft.files, ...incoming.map(named)];
    setDraft({ ...draft, files });
    if (sending.state === "failed") setSending({ state: "idle" });
  };
  const remove = (i: number) => setDraft({ ...draft, files: draft.files.filter((_, j) => j !== i) });

  /* What the page can say before the server does: the text, the count, the types, the sizes. The
     board's or note's own length is the server's to check — it is the one that reads it. */
  const problem = feedbackProblem({
    kind: draft.kind,
    text: draft.text,
    boards: [],
    notes: [],
    files: draft.files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
  });
  const unavailable = status === "failed" || (status !== null && status.destination === null);
  const available = status !== null && !unavailable;
  const busy = sending.state === "sending";
  const canSend = available && !problem && !busy && sending.state !== "sent";

  const send = async () => {
    if (!canSend) return;
    setSending({ state: "sending" });
    try {
      const files = await Promise.all(draft.files.map(async (f) => ({ name: f.name, type: f.type, data: await base64(f) })));
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          text: draft.text,
          boards: attached?.kind === "board" ? [attached.name] : [],
          notes: attached?.kind === "note" ? [attached.name] : [],
          files,
        }),
      });
      const said = (await r.json().catch(() => ({}))) as Partial<FeedbackSent> & { error?: string };
      if (r.status !== 201 || typeof said.url !== "string") {
        setSending({ state: "failed", error: said.error ?? `the app's server answered ${r.status}` });
        return;
      }
      setDraft(EMPTY);
      setSending({ state: "sent", url: said.url });
    } catch (e) {
      setSending({ state: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    e.stopPropagation();
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      add(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    add([...e.dataTransfer.files]);
  };

  const env = status && status !== "failed" ? status.env : null;

  /* The app's dialog frame (`ui/Dialog.tsx`): Escape and a press outside close it, unless a send is
     in flight; Tab stays inside; ctrl+Enter sends. */
  return (
    <Dialog
      scrim={{ "data-dag-feedback": "" }}
      onClose={busy ? undefined : onClose}
      className="dag-settings dag-feedback"
      aria-labelledby="dag-feedback-title"
      data-dragging={dragging ? "" : undefined}
      onPaste={onPaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <header className="dag-settings__head">
        <MessageCircleWarning {...ICON} className="dag-feedback__mark" aria-hidden="true" />
        <h2 id="dag-feedback-title">Send feedback</h2>
        <span className="dag-toolbar__spacer" />
        <button
          type="button"
          className="dag-icon"
          aria-label="Close"
          data-dag-feedback-close=""
          disabled={busy}
          onClick={onClose}
        >
          <X {...ICON} aria-hidden="true" />
        </button>
      </header>

      {sending.state === "sent" ? (
        <div className="dag-feedback__sent" role="status" data-dag-feedback-sent="">
          <p>Thank you. Your feedback is now an issue on GitHub:</p>
          <a href={sending.url} target="_blank" rel="noreferrer" data-dag-feedback-link="">
            <ExternalLink {...ICON} aria-hidden="true" />
            <span>{sending.url.replace(/^https:\/\/github\.com\//, "")}</span>
          </a>
        </div>
      ) : (
        <>
          <div className="dag-feedback__kinds" role="group" aria-label="Kind">
            {(
              [
                ["bug", "Something is wrong"],
                ["idea", "An idea"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="dag-feedback__kind"
                aria-pressed={draft.kind === k}
                data-dag-feedback-kind={k}
                onClick={() => setDraft({ ...draft, kind: k })}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            ref={input}
            className="dag-feedback__text"
            data-dag-feedback-text=""
            rows={5}
            value={draft.text}
            placeholder={
              draft.kind === "bug" ? "What happened, and what did you expect? Steps help." : "What would you like AnyDag to do?"
            }
            aria-label="Your feedback"
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />

          <div className="dag-feedback__files">
            {draft.files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="dag-feedback__file" data-dag-feedback-file={f.name}>
                <span className="dag-feedback__file-name">{f.name}</span>
                <span className="dag-feedback__file-size">{kb(f.size)}</span>
                <button type="button" className="dag-icon" aria-label={`Remove ${f.name}`} onClick={() => remove(i)}>
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            ))}
            {draft.files.length < MAX_FEEDBACK_FILES ? (
              <button
                type="button"
                className="dag-feedback__add"
                data-dag-feedback-add=""
                onClick={() => picker.current?.click()}
              >
                <Paperclip size={13} strokeWidth={2} aria-hidden="true" />
                <span>Add a screenshot, video or file</span>
              </button>
            ) : null}
            <input
              ref={picker}
              type="file"
              hidden
              multiple
              accept="image/*,video/*,application/pdf,text/*"
              data-dag-feedback-picker=""
              onChange={(e) => {
                add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </div>
          {doc ? (
            <label className="dag-feedback__attach">
              <input
                type="checkbox"
                checked={draft.attach}
                data-dag-feedback-attach=""
                onChange={(e) => setDraft({ ...draft, attach: e.target.checked })}
              />
              <span>
                Attach this {doc.kind} (<code>{fileName(doc)}</code>)
              </span>
            </label>
          ) : null}

          <div className="dag-feedback__consent" data-dag-feedback-consent="">
            <p className="dag-feedback__label">What leaves this machine when you press Send</p>
            <ul>
              <li>Your text{draft.kind === "bug" ? ", as a bug report" : ", as an idea"}</li>
              {draft.files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  The file <code>{f.name}</code>
                </li>
              ))}
              {attached ? (
                <li>
                  The whole text of <code>{fileName(attached)}</code>
                </li>
              ) : null}
              <li>{env ? `AnyDag ${env.version}, ${env.os}, ${env.arch}` : "The app's version, system and processor"}</li>
            </ul>
            <p className="dag-feedback__hint">
              Nothing else is attached. It becomes a <strong>public</strong> GitHub issue in mouhcineToumi/anydag, and the files
              are stored by GitHub; we keep no copy. An issue can be removed on request, but GitHub offers no way to delete an
              uploaded file, so anyone who kept its address could still open it.
            </p>
          </div>
        </>
      )}

      {unavailable ? (
        <p className="dag-feedback__error" role="alert" data-dag-feedback-error="">
          Feedback is not available in this copy of AnyDag: it has no feedback relay set.
        </p>
      ) : null}
      {sending.state === "failed" ? (
        <p className="dag-feedback__error" role="alert" data-dag-feedback-error="">
          Not sent: {sending.error}. Your draft is kept.
        </p>
      ) : problem && draft.text.trim() ? (
        <p className="dag-feedback__error" data-dag-feedback-problem="">
          {problem}
        </p>
      ) : null}

      <footer className="dag-settings__foot dag-feedback__foot">
        {sending.state === "sent" ? (
          <button type="button" className="dag-button" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <span className="dag-rewrite-dialog__hint">
              <kbd>ctrl</kbd> <kbd>Enter</kbd> to send
            </span>
            <button
              type="button"
              className="dag-button dag-button--primary"
              data-dag-feedback-send=""
              disabled={!canSend}
              onClick={() => void send()}
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </>
        )}
      </footer>
    </Dialog>
  );
}
