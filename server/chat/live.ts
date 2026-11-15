/**
 * The Assistant's runtime: the turns in flight, what the agent
 * may reach while one runs, and the stream the page listens to.
 *
 * **A turn is one harness run.** It is kept in memory while it runs — its steps, its blocks of
 * changes, the approvals it is waiting on — and written once, as `<turnId>.json`, when it ends. The
 * agent reaches the vault through `anydag-server mcp --chat <id>`, which calls this server's routes
 * with `X-AnyDag-Chat`; `guard` is what every one of those requests goes through, and it is where the
 * reach, the approvals and the change recorder are enforced. Nothing here trusts the prompt.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Context, Next } from "hono";

import { effortFor } from "../../plugins/generate/llm";
import { titleOf } from "../../src/refs/extract";
import type { Session } from "../context";
import { bodyOf, err, mustExist } from "../http";
import { kindOf, leafOf } from "../names";
import type { Vault } from "../vault";
import type { Harness, HarnessEvent, McpCommand, Running } from "./harness";
import { guessed, isUntitled, seeded, systemPrompt, titleFrom, UNTITLED, type Reach } from "./prompt";
import { installFsHooks, record, undo, type Op } from "./record";
import { ChatStore, newId, validChatId } from "./store";
import {
  blockUndone,
  grantsOf,
  isSubject,
  type Block,
  type ChatEvent,
  type ChatMeta,
  type ChatRead,
  type ChatRow,
  type DocKind,
  type Mode,
  type Provider,
  type Step,
  type Subject,
  type Turn,
  type UndoRecord,
} from "./types";

/** What the approval card asks before a write outside the chat's subject. */
const outside = (s: Subject): string => `Change something other than “${s.title}”?`;

/** How long a write or a vault request waits for the person. Both harnesses' MCP timeouts are longer. */
const APPROVAL_MS = 5 * 60_000;

/** The longest tool answer a turn keeps: the model saw it all, the page needs the gist. */
const OUTPUT_CAP = 4000;

/** A tool call the model wrote into its reply instead of calling: `<invoke name=…>` / `<parameter name=…>`. */
const WRITTEN_CALL = /<(?:invoke|parameter)\s+name=/;

/** What the person sees when that happened. The raw text goes only to the server log. */
const WRITTEN_CALL_ERROR = "The model wrote a tool call as text instead of calling it, and no tool ran. Nothing was changed.";

/** The writes a chat may make at all. Anything else non-GET is refused, whatever the grant. */
const WRITES = new Set([
  "/__board/create",
  "/__board/patch",
  "/__board/put",
  "/__board/rename",
  "/__board/retitle",
  "/__board/duplicate",
  "/__board/delete",
  "/__board/mkdir",
  "/__board/mvdir",
  "/__board/rmdir",
  "/__board/asset",
  "/__board/upload",
  "/__board/file",
  "/__board/event",
  "/__board/project",
  "/__board/task",
  "/__board/quiz",
  "/__board/table",
  "/__board/transfer",
  "/__board/trash/restore",
  "/__board/trash/delete",
  "/__board/assets/sweep",
  "/__board/components/delete",
]);

/** Non-GET routes that only read. */
const READS = new Set(["/__board/diagnostics"]);

/** Writes that wait for the person: they take something away, or move a lot at once. */
/** What the approval card asks, as a sentence a person can say yes to without knowing the route. */
const APPROVE: Record<string, string> = {
  "/__board/delete": "Move a file to the trash?",
  "/__board/rmdir": "Move a folder to the trash?",
  "/__board/mvdir": "Move a folder?",
  "/__board/transfer": "Move to another vault?",
  "/__board/trash/delete": "Delete from the trash for good?",
  "/__board/assets/sweep": "Delete this file's unused images?",
  "/__board/components/delete": "Delete a saved component?",
};

/** A document's name as the routes read it: `str` in `server/routes/docs.ts`, byte for byte. */
const nameIn = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/**
 * The writes that change one document and nothing else, and which document each one names — read
 * exactly as the route reads it, so the document the guard compares is the one the route writes.
 * In a chat with a subject (#323) these, aimed at the subject, are the only writes made without
 * asking: every other write, a new document included, waits for the person. A rename, a retitle
 * (which relinks other documents) and a picture (which makes an attachment) are not here on purpose.
 */
const ONE_DOC: Record<
  string,
  (
    q: (k: string) => string | undefined,
    body: () => Promise<Record<string, unknown>>,
  ) => Promise<{ name: string; kind: DocKind } | null>
> = {
  "/__board/put": async (q) => {
    const kind = kindOf(q("kind"));
    return kind ? { name: q("name") ?? "", kind } : null;
  },
  "/__board/patch": async (q) => ({ name: q("name") ?? "", kind: "board" }),
  "/__board/task": async (_q, body) => ({ name: nameIn((await body()).name), kind: "note" }),
  "/__board/project": async (_q, body) => ({ name: nameIn((await body()).name), kind: "note" }),
  "/__board/event": async (_q, body) => ({ name: nameIn((await body()).name), kind: "note" }),
  "/__board/table": async (_q, body) => ({ name: nameIn((await body()).name), kind: "table" }),
  "/__board/quiz": async (_q, body) => ({ name: nameIn((await body()).name), kind: "quiz" }),
};

/** What a write outside a chat's subject would do, as the first word of its approval card's line. */
const VERB: Record<string, string> = {
  "/__board/create": "Make",
  "/__board/put": "Rewrite",
  "/__board/patch": "Edit",
  "/__board/rename": "Rename",
  "/__board/retitle": "Retitle",
  "/__board/duplicate": "Copy",
  "/__board/mkdir": "Make the folder",
  "/__board/asset": "Add a picture to",
  "/__board/upload": "Add a picture for",
  "/__board/file": "Upload",
  "/__board/table": "Edit",
  "/__board/quiz": "Edit",
  "/__board/trash/restore": "Restore",
};

/** A route whose body is the bytes of a file, which reading it as JSON would spend. */
const STREAMED = new Set(["/__board/file"]);

/** A subject's words as the prompt and the approval card say them: one line, and not a page of it. */
const oneLine = (s: string, max = 120): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

interface Waiting {
  step: number;
  resolve: (yes: boolean | null) => void;
  timer: NodeJS.Timeout;
}

interface Live {
  turn: Turn;
  root: string;
  meta: ChatMeta;
  /** The text arriving token by token, not yet closed by a `text` step. */
  typing: string;
  running: Running | null;
  stopping: boolean;
  waiting: Map<string, Waiting>;
  /** Provider session this turn runs in. */
  session: string | null;
  /** Set when the turn must fail whatever the harness says: a tool call written into the reply. */
  broken?: string;
  /**
   * The document this turn works on, fixed when it starts: the guard asks before any write that
   * does not change it alone. Nothing the agent does during the turn can move it.
   */
  subject: Subject | null;
}

export interface AssistantOptions {
  session: Session;
  token: string;
  harnesses: Partial<Record<Provider, Harness>>;
  /** How the chat's MCP server is started; the default re-runs this process as `mcp --chat`. */
  mcp?: (chat: string, origin: { port: number; token: string }) => McpCommand;
  /** Where a run's scratch files go. */
  scratch?: string;
}

type Listener = (e: ChatEvent) => void;

export class Assistant {
  readonly store: ChatStore;
  private live = new Map<string, Live>();
  private listeners = new Map<string, Set<Listener>>();
  private port = 0;

  constructor(private opts: AssistantOptions) {
    installFsHooks();
    this.store = new ChatStore(opts.session.home);
  }

  get s(): Session {
    return this.opts.session;
  }

  /** The port this server listens on, once it does: the chat's MCP server dials it. */
  listening(port: number): void {
    this.port = port;
  }

  /** Whether every harness is the scripted one — what the e2e suite checks before it says a word. */
  fake(): boolean {
    const hs = Object.values(this.opts.harnesses).filter(Boolean);
    return hs.length > 0 && hs.every((h) => h!.fake);
  }

  providers(): Provider[] {
    return (Object.keys(this.opts.harnesses) as Provider[]).filter((p) => this.opts.harnesses[p]);
  }

  /* -- the stream -------------------------------------------------------------------------- */

  /** Hear one chat's events, or every chat's with `"*"`. */
  listen(chat: string, fn: Listener): () => void {
    let set = this.listeners.get(chat);
    if (!set) this.listeners.set(chat, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(chat: string, e: ChatEvent): void {
    for (const key of [chat, "*"]) for (const fn of this.listeners.get(key) ?? []) fn(e);
  }

  /* -- finding a chat ---------------------------------------------------------------------- */

  private rootOf(vault: string): string | null {
    try {
      return this.s.pick(vault).vault.root;
    } catch {
      return null;
    }
  }

  /** Where a chat lives: the vault named first, then any other open vault that holds it. */
  locate(chat: string, vault?: string | null): { root: string; vault: string; meta: ChatMeta } {
    if (!validChatId(chat)) throw err(400, `\`${chat}\` is not a chat id`);
    const live = this.live.get(chat);
    if (live) return { root: live.root, vault: live.meta.home, meta: live.meta };
    /* The page's history lists every open vault, so a row from another one opens by id even though
       this tab names its own vault on every request. `pick` still refuses a vault that is not open. */
    const named = vault ? this.s.pick(vault).vault : null;
    const tried = named ? [named, ...this.s.served().filter((v) => v.id !== named.id)] : this.s.served();
    for (const v of tried) {
      const meta = this.store.meta(v.root, chat);
      if (meta) return { root: v.root, vault: v.id, meta: this.reachOf(meta, v.id) };
    }
    throw err(404, `no chat \`${chat}\``, { code: "chat" });
  }

  /**
   * `chat.json` with what it reaches put in by this machine (#9). The file is vault content — sync
   * carries it, and so does anyone who writes the folder — so its `home` and `grant:` keys are not
   * read: the chat's own vault is the one it was found in, and its grants are the person's, from
   * the app's home. Everything that decides reach — the guard, the prompt, `vault_request`, undo —
   * reads a meta that came through here.
   */
  private reachOf(file: ChatMeta, home: string): ChatMeta {
    const meta = Object.fromEntries(Object.entries(file).filter(([k]) => !k.startsWith("grant:"))) as unknown as ChatMeta;
    meta.home = home;
    for (const [vault, g] of Object.entries(this.store.grants(file.id))) if (vault !== home) meta[`grant:${vault}`] = g;
    /* A subject only ever narrows what a turn writes unasked, so the file's word is taken for it —
       but one without a subject's shape is not a subject, and is not handed on. */
    if (meta.subject !== undefined && meta.subject !== null && !isSubject(meta.subject)) delete meta.subject;
    return meta;
  }

  list(vault?: string | null): ChatRow[] {
    const vaults = vault ? [this.s.pick(vault).vault] : this.s.served();
    return vaults
      .flatMap((v) => this.store.list(v.root, v.id, (id) => this.live.has(id)))
      .sort((a, b) => (a.updated < b.updated ? 1 : -1));
  }

  read(chat: string, vault?: string | null): ChatRead {
    const { root, vault: at, meta } = this.locate(chat, vault);
    const live = this.live.get(chat);
    return {
      chat: live?.meta ?? meta,
      vault: at,
      turns: this.store.turns(root, chat),
      undos: this.store.undos(root, chat),
      live: live ? this.snapshot(live) : null,
      device: this.store.device,
    };
  }

  private snapshot(l: Live): Turn {
    const steps = l.typing ? [...l.turn.steps, { kind: "text" as const, text: l.typing }] : l.turn.steps;
    return { ...l.turn, steps, blocks: l.turn.blocks.map((b) => ({ ...b })) };
  }

  create(vault: string | null | undefined, o: { provider: Provider; model: string; effort?: string; title?: string }): ChatMeta {
    const v = this.s.pick(vault).vault;
    if (!this.opts.harnesses[o.provider]) throw err(400, `\`${o.provider}\` is not available here`, { code: "provider" });
    const meta = this.store.create(v.root, {
      title: o.title?.trim() || UNTITLED,
      home: v.id,
      provider: o.provider,
      model: o.model,
      ...(o.effort ? { effort: o.effort } : {}),
    });
    const answered = this.reachOf(meta, v.id);
    this.emit(meta.id, { type: "chat", chat: answered });
    return answered;
  }

  private change(chat: string, vault: string | null | undefined, fn: (m: ChatMeta) => void): ChatMeta {
    const { root, vault: home } = this.locate(chat, vault);
    return this.told(chat, this.reachOf(this.store.update(root, chat, fn), home));
  }

  /** The chat as it now is, to a turn running in it and to everyone listening. */
  private told(chat: string, meta: ChatMeta): ChatMeta {
    const live = this.live.get(chat);
    if (live) live.meta = meta;
    this.emit(chat, { type: "chat", chat: meta });
    return meta;
  }

  rename(chat: string, title: string, vault?: string | null): ChatMeta {
    const clean = title.replace(/\s+/g, " ").trim();
    if (!clean) throw err(400, "a chat needs a title");
    return this.change(chat, vault, (m) => (m.title = clean.slice(0, 200)));
  }

  /**
   * Grant a vault, or take it back (`mode: null`): the person's answer, on this machine, and the only
   * thing that writes a grant. It is kept in the app's home and never in `chat.json` (#9).
   */
  grant(chat: string, target: string, mode: Mode | null, vault?: string | null): ChatMeta {
    const { root, vault: home, meta } = this.locate(chat, vault);
    if (target === meta.home) throw err(400, "a chat always reaches its own vault");
    if (mode) this.s.pick(target);
    this.store.setGrant(chat, target, mode ? { mode, at: new Date().toISOString() } : null);
    const file = this.store.meta(root, chat);
    if (!file) throw err(404, `no chat \`${chat}\``, { code: "chat" });
    return this.told(chat, this.reachOf(file, home));
  }

  async remove(chat: string, vault?: string | null): Promise<void> {
    const { root } = this.locate(chat, vault);
    if (this.live.has(chat)) throw err(409, "the chat is answering; stop it first", { code: "running" });
    for (const p of this.providers()) {
      const s = this.store.session(chat, p);
      if (s) await this.opts.harnesses[p]!.forget(s.id).catch(() => undefined);
    }
    this.store.remove(root, chat);
    this.emit(chat, { type: "gone", chat });
  }

  /* -- a turn ------------------------------------------------------------------------------ */

  /**
   * Start a turn. Answers the turn as it starts; the rest arrives on the stream.
   *
   * `subject` is the document the page's chip shows (#323): a document of the page's vault to work
   * on, `null` for a chip the person removed — the chat is about the whole vault again — and absent
   * to keep what the chat had, looked up again by its id so a rename since is followed.
   */
  async say(
    chat: string,
    text: string,
    o: {
      vault?: string | null;
      provider?: Provider;
      model?: string;
      effort?: string | null;
      subject?: { name: string; kind: DocKind } | null;
    } = {},
  ): Promise<Turn> {
    const words = text.trim();
    if (!words) throw err(400, "say something");
    const busy = () => {
      if (this.live.has(chat)) throw err(409, "the chat is already answering", { code: "running" });
    };
    busy();
    if (!this.port && !this.opts.mcp)
      throw err(409, "the Assistant answers in the app's own server; start it (`anydag serve`) and ask there", {
        code: "no-server",
      });
    const { root, vault: home, meta: was } = this.locate(chat, o.vault);
    const subject =
      o.subject === undefined
        ? await this.refreshed(was.subject)
        : o.subject === null
          ? null
          : await this.subjectOf(o.vault || home, o.subject.name, o.subject.kind);
    /* Looking the subject up handed the thread back: another turn may have started meanwhile. */
    busy();
    const file = this.store.update(root, chat, (m) => {
      if (subject !== undefined) m.subject = subject;
      if (o.provider) m.provider = o.provider;
      if (o.model) m.model = o.model;
      if (o.effort !== undefined) {
        if (o.effort) m.effort = o.effort;
        else delete m.effort;
      }
      if (isUntitled(m)) m.title = titleFrom(words);
    });
    const meta = this.reachOf(file, home);
    const harness = this.opts.harnesses[meta.provider];
    if (!harness) throw err(400, `\`${meta.provider}\` is not available here`, { code: "provider" });
    this.emit(chat, { type: "chat", chat: meta });

    const turn: Turn = {
      v: 1,
      id: newId("t", this.store.device),
      chat,
      device: this.store.device,
      at: new Date().toISOString(),
      text: words,
      provider: meta.provider,
      model: meta.model,
      ...(meta.effort ? { effort: meta.effort } : {}),
      steps: [],
      blocks: [],
      status: "running",
    };
    const live: Live = {
      turn,
      root,
      meta,
      typing: "",
      running: null,
      stopping: false,
      waiting: new Map(),
      session: null,
      subject: meta.subject ?? null,
    };
    this.live.set(chat, live);
    this.emit(chat, { type: "turn", turn: this.snapshot(live) });

    // Resume the provider's session when it has seen every turn so far; otherwise start one and
    // tell it the chat so far — a switch of provider, or turns made on another machine.
    const prior = this.store.turns(root, chat);
    const had = this.store.session(chat, meta.provider);
    const seen = had ? prior.findIndex((t) => t.id === had.turn) : -1;
    const resume = had && seen >= 0 ? had.id : undefined;
    const unseen = resume ? prior.slice(seen + 1) : prior;
    const fresh = resume ? undefined : crypto.randomUUID();
    if (fresh) live.session = fresh;
    else live.session = resume ?? null;

    const scratch = fs.mkdtempSync(path.join(this.opts.scratch ?? os.tmpdir(), `anydag-chat-${chat}-`));
    /* The chat keeps the scale's word (`max`), which is what its header shows; the harness gets
       what its provider calls it, and nothing when that provider has no such word. */
    const effort = meta.effort ? effortFor(meta.provider, { reasoning: meta.effort }) : undefined;
    const run = () => {
      try {
        live.running = harness.run(
          {
            chat,
            model: meta.model,
            ...(effort ? { effort } : {}),
            system: systemPrompt({
              ...this.reach(meta),
              subject: live.subject && { ...live.subject, home: live.subject.vault === meta.home },
            }),
            prompt: seeded(unseen, words),
            ...(resume ? { resume } : { fresh }),
            mcp: this.mcpFor(chat),
            scratch,
          },
          (e) => this.heard(live, e),
        );
      } catch (e) {
        live.turn.steps.push({ kind: "error", text: (e as Error).message });
        void this.end(live, { error: (e as Error).message }, scratch);
        return;
      }
      void live.running.done.then((end) => this.end(live, end, scratch));
    };
    run();
    return this.snapshot(live);
  }

  /** The document `name` of `kind` in `vault` as a chat's subject, or the 404 for it. Writes nothing. */
  private async subjectOf(vault: string, name: string, kind: DocKind): Promise<Subject> {
    const v = this.s.pick(vault).vault;
    await mustExist(v, name, kind);
    return { vault: v.id, kind, name, id: await v.peekId(name, kind), title: oneLine(await this.titleIn(v, name, kind)) };
  }

  /** What the page calls a document: its title, else the last part of its name. */
  private async titleIn(v: Vault, name: string, kind: DocKind): Promise<string> {
    if (kind === "file") return (await v.fileInfo(name))?.title || leafOf(name);
    return titleOf((await v.read(name, kind))?.text ?? "") || leafOf(name);
  }

  /**
   * The chat's subject as it is now: found again by its id, so a rename or a move since is followed.
   * One that cannot be found — its vault closed, the document gone — is kept as it was, still the
   * subject: a write to anything else still asks.
   */
  private async refreshed(had: Subject | null | undefined): Promise<Subject | null | undefined> {
    if (!had?.id) return had;
    try {
      const v = this.s.pick(had.vault).vault;
      const found = await v.resolve(had.id);
      return found ? await this.subjectOf(had.vault, found.name, found.kind) : had;
    } catch {
      return had;
    }
  }

  private reach(meta: ChatMeta): { reach: Reach[]; others: { id: string; name: string }[] } {
    const grants = grantsOf(meta);
    const reach: Reach[] = [];
    const others: { id: string; name: string }[] = [];
    for (const v of this.s.served()) {
      const name = path.basename(v.root);
      if (v.id === meta.home) reach.push({ id: v.id, name, mode: "edit", home: true });
      else if (grants[v.id]) reach.push({ id: v.id, name, mode: grants[v.id]!.mode, home: false });
      else others.push({ id: v.id, name });
    }
    return { reach, others };
  }

  private mcpFor(chat: string): McpCommand {
    const origin = { port: this.port, token: this.opts.token };
    if (this.opts.mcp) return this.opts.mcp(chat, origin);
    const env: Record<string, string> = {
      ANYDAG_CHAT_PORT: String(this.port),
      ANYDAG_TOKEN: this.opts.token,
      ANYDAG_HOME: this.s.home.dir,
    };
    /* The desktop app runs this server as Electron-as-Node, so `process.execPath` is Electron. The
       MCP child is the same binary running `mcp --chat`; without the switch it starts as an Electron
       app, fails to open a window (its env has no display) and dies before it speaks MCP. */
    const electron = process.env.ELECTRON_RUN_AS_NODE;
    if (electron) env.ELECTRON_RUN_AS_NODE = electron;
    const bin = process.env.ANYDAG_CHAT_MCP_BIN;
    if (bin) return { command: bin, args: ["mcp", "--chat", chat], env };
    return {
      command: process.execPath,
      args: [...process.execArgv, process.argv[1]!, "mcp", "--chat", chat],
      env,
    };
  }

  private push(live: Live, step: Step): number {
    live.turn.steps.push(step);
    const index = live.turn.steps.length - 1;
    this.emit(live.turn.chat, { type: "step", turn: live.turn.id, index, step });
    return index;
  }

  /**
   * The reply text, unless the model wrote a tool call into it. A turn with no tool step yet that
   * says `<invoke name=…>` or `<parameter name=…>` has guessed the protocol: the text is the server's
   * log's, never the person's answer, and the turn fails.
   */
  private said(live: Live, text: string): void {
    if (live.turn.steps.some((s) => s.kind === "tool")) {
      if (text.trim()) this.push(live, { kind: "text", text });
      return;
    }
    if (WRITTEN_CALL.test(text)) {
      live.broken ??= WRITTEN_CALL_ERROR;
      console.error(`anydag: chat ${live.turn.chat}: the model wrote a tool call as text; no tool ran:\n${text}`);
      if (!live.turn.steps.some((s) => s.kind === "error" && s.text === WRITTEN_CALL_ERROR))
        this.push(live, { kind: "error", text: WRITTEN_CALL_ERROR });
      return;
    }
    if (text.trim()) this.push(live, { kind: "text", text });
  }

  private heard(live: Live, e: HarnessEvent): void {
    const chat = live.turn.chat;
    switch (e.kind) {
      case "delta":
        live.typing += e.text;
        this.emit(chat, { type: "delta", turn: live.turn.id, text: e.text });
        return;
      case "text":
        live.typing = "";
        this.said(live, e.text);
        return;
      case "tool":
        live.typing = "";
        this.push(live, { kind: "tool", id: e.id, name: e.name, input: e.input });
        return;
      case "result": {
        const index = live.turn.steps.findIndex((s) => s.kind === "tool" && s.id === e.id);
        if (index < 0) return;
        const step = live.turn.steps[index] as Extract<Step, { kind: "tool" }>;
        step.output = e.output.length > OUTPUT_CAP ? `${e.output.slice(0, OUTPUT_CAP)}…` : e.output;
        if (e.error) step.error = true;
        this.emit(chat, { type: "step", turn: live.turn.id, index, step });
        return;
      }
      case "session":
        live.session = e.id;
        return;
      case "error":
        this.push(live, { kind: "error", text: e.text });
        return;
    }
  }

  private async end(live: Live, end: { usage?: Turn["usage"]; error?: string }, scratch: string): Promise<void> {
    if (this.live.get(live.turn.chat) !== live) return;
    for (const [, w] of live.waiting) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    if (live.typing.trim()) this.said(live, live.typing);
    live.typing = "";
    const failure = live.broken ?? end.error;
    if (failure && !live.stopping && !live.turn.steps.some((s) => s.kind === "error" && s.text === failure))
      live.turn.steps.push({ kind: "error", text: failure });
    live.turn.status = live.stopping ? "stopped" : failure ? "failed" : "done";
    live.turn.ended = new Date().toISOString();
    if (end.usage) live.turn.usage = end.usage;
    live.turn.blocks = live.turn.blocks.filter((b) => b.ops.length);
    try {
      this.store.writeTurn(live.root, live.turn);
    } catch (e) {
      console.error(`anydag: chat ${live.turn.chat}: the turn could not be kept:`, e);
    }
    try {
      /* A failed turn that ran no tool was the model guessing without them: it is not resumable,
         and the session it ran in is dropped so the next turn starts fresh and seeds the transcript
         instead. A turn that failed after a tool ran (an overloaded API, a dropped connection) did
         change the vault, so its session is kept for the next turn to resume. */
      if (guessed(live.turn)) this.store.setSession(live.turn.chat, live.turn.provider, null);
      else if (live.session)
        this.store.setSession(live.turn.chat, live.turn.provider, {
          id: live.session,
          model: live.turn.model,
          turn: live.turn.id,
        });
    } catch (e) {
      console.error(`anydag: chat ${live.turn.chat}: the provider session could not be kept:`, e);
    }
    this.live.delete(live.turn.chat);
    fs.rmSync(scratch, { recursive: true, force: true });
    this.emit(live.turn.chat, { type: "end", turn: live.turn });
  }

  async stop(chat: string): Promise<void> {
    const live = this.live.get(chat);
    if (!live) return;
    live.stopping = true;
    for (const [, w] of live.waiting) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    await live.running?.stop();
  }

  /** The person's answer to an approval or a vault request. */
  answer(chat: string, step: string, yes: boolean): void {
    const live = this.live.get(chat);
    const w = live?.waiting.get(step);
    if (!live || !w) throw err(404, "nothing is waiting for that answer", { code: "answered" });
    clearTimeout(w.timer);
    w.resolve(yes);
  }

  /** Put a step to the person and wait: true, false, or null when it expired or the turn stopped. */
  private ask(live: Live, step: Extract<Step, { kind: "approval" | "access" }>): Promise<boolean | null> {
    const index = this.push(live, step);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), APPROVAL_MS);
      const done = (yes: boolean | null) => {
        live.waiting.delete(step.id);
        step.answer = yes === null ? "expired" : yes ? "yes" : "no";
        this.emit(live.turn.chat, { type: "step", turn: live.turn.id, index, step });
        resolve(yes);
      };
      live.waiting.set(step.id, { step: index, resolve: done, timer });
    });
  }

  /* -- what the agent reaches -------------------------------------------------------------- */

  /** The live turn behind a request from a chat's MCP server, or a refusal. */
  private turnOf(c: Context): Live {
    const chat = c.req.header("x-anydag-chat") ?? "";
    const live = this.live.get(chat);
    if (!live) throw err(409, "this chat has no turn running", { code: "no-turn" });
    return live;
  }

  /**
   * Every request carrying `X-AnyDag-Chat` comes through here: the reach, the approval,
   * and the recording of what it changed.
   */
  async guard(c: Context, next: Next): Promise<Response | void> {
    const live = this.turnOf(c);
    const p = c.req.path;
    if (p.startsWith("/__board/chat/")) return next();
    const method = c.req.method;
    const reads = method === "GET" || method === "HEAD" || READS.has(p);
    if (!reads && !WRITES.has(p)) throw err(403, `a chat may not call ${method} ${p}`, { code: "chat-refused" });
    if (!p.startsWith("/__board")) {
      if (!reads) throw err(403, `a chat may not call ${method} ${p}`, { code: "chat-refused" });
    }
    const meta = live.meta;
    const vault = c.req.query("vault") || meta.home;
    const mode = this.modeIn(meta, vault);
    if (!mode)
      throw err(403, `this chat does not reach vault \`${vault}\`; ask for it with vault_request`, { code: "not-granted" });
    if (!reads && mode === "ask") {
      throw err(
        403,
        `vault \`${vault}\` was granted to read only; call vault_request with mode \`edit\` to ask the person for more`,
        { code: "read-only" },
      );
    }
    if (p === "/__board/transfer") {
      const body = (await c.req.json().catch(() => ({}))) as { to?: unknown };
      const to = typeof body.to === "string" ? body.to : "";
      if (this.modeIn(meta, to) !== "edit") throw err(403, `this chat may not change vault \`${to}\``, { code: "not-granted" });
    }
    return this.s.within(vault, async () => {
      if (reads) return next();
      const what =
        APPROVE[p] ?? (live.subject && !(await this.onSubject(c, live.subject, vault)) ? outside(live.subject) : undefined);
      if (what) {
        /* Outside the subject, the card says what the write would do: any write route can be one. */
        const detail = APPROVE[p] ? await this.detailOf(c) : `${VERB[p] ?? "Change"} ${await this.detailOf(c)}`;
        const yes = await this.ask(live, { kind: "approval", id: newId("b", this.store.device), what, detail, answer: null });
        if (!yes)
          throw err(
            403,
            yes === null ? "the person did not answer in time; nothing was changed" : "the person said no; nothing was changed",
            { code: "declined" },
          );
      }
      const { op } = await record({ id: vault, root: this.s.vault.root }, `${method} ${p}`, async () => {
        await next();
      });
      if (op) {
        // A transfer writes into a second vault the recorder did not watch: its undo would be half.
        if (p === "/__board/transfer") op.undoable = false;
        this.addOp(live, op);
      }
    });
  }

  /** What a chat may do in a vault: its grant's mode, or nothing. Its own vault is always changeable. */
  private modeIn(meta: ChatMeta, vault: string): Mode | null {
    if (vault === meta.home) return "edit";
    const g = meta[`grant:${vault}`];
    if (!g) return null;
    return g.mode;
  }

  /**
   * Whether a write changes the chat's subject and nothing else: a route of `ONE_DOC`, in the
   * subject's vault, naming the file the subject is. Runs inside the vault's scope.
   */
  private async onSubject(c: Context, subject: Subject, vault: string): Promise<boolean> {
    if (vault !== subject.vault) return false;
    const read = ONE_DOC[c.req.path];
    if (!read) return false;
    const target = await read(
      (k) => c.req.query(k),
      () => bodyOf(c).catch(() => ({})),
    );
    if (!target || !target.name) return false;
    try {
      return this.s.vault.fileOf(target.name, target.kind) === this.s.vault.fileOf(subject.name, subject.kind);
    } catch {
      return false;
    }
  }

  private async detailOf(c: Context): Promise<string> {
    const body = STREAMED.has(c.req.path) ? {} : ((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
    const at = (k: string) => (typeof body[k] === "string" && body[k] ? (body[k] as string) : null);
    const what = at("name") ?? at("folder") ?? at("from") ?? at("id") ?? (c.req.query("name") || null);
    const to = at("to");
    // A transfer's `to` is a vault id, which says nothing to a person; a move's is a folder.
    const where = to && c.req.path !== "/__board/transfer" ? ` → ${to}` : "";
    return what ? `${what}${where}` : c.req.path;
  }

  private addOp(live: Live, op: Op): void {
    let block = live.turn.blocks[live.turn.blocks.length - 1];
    if (!block) {
      block = { id: newId("b", this.store.device), title: "Changes", ops: [] };
      live.turn.blocks.push(block);
    }
    block.ops.push(op);
    this.emit(live.turn.chat, { type: "blocks", turn: live.turn.id, blocks: live.turn.blocks });
  }

  /** `change_block`: the next writes are a group of their own. */
  block(c: Context, title: string): Block {
    const live = this.turnOf(c);
    const last = live.turn.blocks[live.turn.blocks.length - 1];
    const clean = title.replace(/\s+/g, " ").trim().slice(0, 120) || "Changes";
    if (last && !last.ops.length) last.title = clean;
    else live.turn.blocks.push({ id: newId("b", this.store.device), title: clean, ops: [] });
    this.emit(live.turn.chat, { type: "blocks", turn: live.turn.id, blocks: live.turn.blocks });
    return live.turn.blocks[live.turn.blocks.length - 1]!;
  }

  /** `vault_request`: ask the person for another vault, and wait. */
  async access(c: Context, vault: string, why: string, mode: Mode): Promise<{ granted: boolean; mode?: Mode; error?: string }> {
    const live = this.turnOf(c);
    let name: string;
    try {
      name = path.basename(this.s.pick(vault).vault.root);
    } catch {
      return { granted: false, error: `vault \`${vault}\` is not open; vault_list says which are` };
    }
    if (vault === live.meta.home) return { granted: true, mode: "edit" };
    const had = live.meta[`grant:${vault}`];
    if (had && (had.mode === "edit" || mode === "ask")) return { granted: true, mode: had.mode };
    const yes = await this.ask(live, {
      kind: "access",
      id: newId("b", this.store.device),
      vault,
      name,
      why: why.slice(0, 500),
      mode,
      answer: null,
    });
    if (!yes) return { granted: false, error: yes === null ? "the person did not answer in time" : "the person said no" };
    this.grant(live.turn.chat, vault, mode, live.meta.home);
    return { granted: true, mode };
  }

  /* -- undo -------------------------------------------------------------------------------- */

  /** Undo a block, or redo one that was undone. */
  async undo(chat: string, turnId: string, blockId: string, redo: boolean, vault?: string | null): Promise<UndoRecord> {
    const { root, meta } = this.locate(chat, vault);
    if (this.live.has(chat)) throw err(409, "the chat is answering; undo once it has finished", { code: "running" });
    const turn = this.store.turns(root, chat).find((t) => t.id === turnId);
    const block = turn?.blocks.find((b) => b.id === blockId);
    if (!turn || !block) throw err(404, "no such block", { code: "block" });
    const undos = this.store.undos(root, chat);
    const undone = blockUndone(undos, blockId);
    if (redo !== undone) throw err(409, redo ? "that block is not undone" : "that block is already undone", { code: "state" });
    let ops: Op[] = block.ops;
    if (redo) {
      const last = undos.filter((u) => u.block === blockId).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
      ops = last?.ops ?? [];
    }
    // An op names its vault, and the turn file it came from is anybody's who can write this vault: an
    // undo reaches only the chat's own vault and the ones it was granted — taken back since or not,
    // since undoing what a grant once allowed is the person's act, not the agent's.
    const reaches = (v: string) => v === meta.home || Object.prototype.hasOwnProperty.call(meta, `grant:${v}`);
    const done = await undo(ops, (v) => this.rootOf(v), reaches);
    const rec: UndoRecord = {
      v: 1,
      id: newId("u", this.store.device),
      chat,
      turn: turnId,
      block: blockId,
      redo,
      device: this.store.device,
      at: new Date().toISOString(),
      ops: done.ops,
      conflicts: done.conflicts,
    };
    this.store.writeUndo(root, rec);
    this.emit(chat, { type: "undo", record: rec });
    return rec;
  }

  async close(): Promise<void> {
    for (const chat of [...this.live.keys()]) await this.stop(chat);
    for (const h of Object.values(this.opts.harnesses)) await h?.close().catch(() => undefined);
  }
}
