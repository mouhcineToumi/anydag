import { blockUndone, grantsOf, PROVIDERS, type Block, type ChatEvent, type ChatRead, type ChatRow, type Mode, type Provider, type Step, type Turn, type UndoRecord } from "../../server/chat/types";

import { EXIT } from "../api";
import { UsageError, bool, str, type Parsed } from "../args";
import { confirm, emit, readText, table, type Command, type Ctx } from "../context";
import { events } from "./docs";

/**
 * The Assistant, from a terminal.
 *
 * A chat is a conversation with a model that works on the vault through the app's own routes; this
 * is the page's chat panel as commands. `say` is the one with a stream in it: it opens the chat's
 * event feed **before** it sends the turn, because a turn that finishes between the POST and the
 * subscription would otherwise be a turn nobody ever heard end — the stream buffers what arrives
 * while the POST is out. `server/chat/types.ts` is imported for `blockUndone` and `grantsOf`, which
 * the page uses too, so "is this block undone" has one answer; it holds only types and those two
 * functions, so the bundle takes nothing else of the server.
 *
 * The two routes a chat's own MCP server calls (`/__board/chat/block`, `/__board/chat/access`) are
 * refused in `docs/parity.json`: they answer only a request carrying `X-AnyDag-Chat`.
 */

const MODES: readonly Mode[] = ["ask", "edit"];

interface ModelsList {
  providers: { provider: Provider; available: boolean; models: { id: string }[]; default: string }[];
}

/* ---- pure helpers: held by test/cli-chat.test.ts ------------------------------------------------ */

/** The mode a flag says, or a usage error naming the two there are. */
export function modeOf(raw: string | undefined): Mode | undefined {
  if (raw === undefined) return undefined;
  if (!MODES.includes(raw as Mode)) throw new UsageError(`--mode is \`ask\` or \`edit\`, not \`${raw}\``);
  return raw as Mode;
}

export function providerOf(raw: string | undefined): Provider | undefined {
  if (raw === undefined) return undefined;
  if (!PROVIDERS.includes(raw as Provider)) throw new UsageError(`--provider is ${PROVIDERS.map((p) => `\`${p}\``).join(" or ")}, not \`${raw}\``);
  return raw as Provider;
}

/** `ask`, `edit`, or `off` (taking the grant back, which the route spells `null`); none means `ask`. */
export function grantMode(raw: string | undefined): Mode | null {
  if (raw === undefined) return "ask";
  if (raw === "off") return null;
  if (!MODES.includes(raw as Mode)) throw new UsageError(`a grant is \`ask\`, \`edit\` or \`off\`, not \`${raw}\``);
  return raw as Mode;
}

/** An approval's answer as the route wants it. */
export function answerOf(raw: string): boolean {
  const s = raw.toLowerCase();
  if (["yes", "y", "true"].includes(s)) return true;
  if (["no", "n", "false"].includes(s)) return false;
  throw new UsageError(`the answer is \`yes\` or \`no\`, not \`${raw}\``);
}

/** What a new chat starts on when no `--provider` was given: the first the server says it can run. */
export function startOn(models: ModelsList, provider?: Provider, model?: string): { provider: Provider; model: string } {
  const entry = provider ? models.providers.find((p) => p.provider === provider) : models.providers.find((p) => p.available);
  if (!entry) throw new UsageError(provider ? `\`${provider}\` is not one the server knows` : "no provider is available — `anydag chat models` says why");
  if (provider && !entry.available) throw new UsageError(`\`${provider}\` is not available here — \`anydag chat models\` says why`);
  return { provider: entry.provider, model: model ?? entry.default };
}

const oneLine = (s: string, max = 120): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The chat list's rows, newest first. */
export function rowLines(rows: readonly ChatRow[]): string[] {
  const sorted = [...rows].sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return table(sorted.map((r) => [r.id, `${r.provider}/${r.model}`, r.updated.slice(0, 16).replace("T", " "), r.running ? "running" : "", r.title]));
}

const answered = (a: "yes" | "no" | "expired" | null): string => (a === null ? "waiting for an answer" : a);

/** One step as the lines a transcript shows. A tool call is one line, `→ name`; its output is not. */
export function stepLines(step: Step): string[] {
  switch (step.kind) {
    case "text":
      return step.text.split("\n");
    case "tool":
    {
      // A chat's `doc_<op>` says its kind in its input: `doc_read (note)`.
      const kind = (step.input as { kind?: unknown } | null)?.kind;
      const what = step.name.startsWith("doc_") && typeof kind === "string" ? `${step.name} (${kind})` : step.name;
      return [`→ ${what}${step.error ? "  (failed)" : ""}`];
    }
    case "approval":
      return [`? ${step.what}${step.detail ? ` — ${oneLine(step.detail)}` : ""} — ${answered(step.answer)}`];
    case "access":
      return [`? reach vault ${step.name} (${step.mode})${step.why ? `: ${oneLine(step.why)}` : ""} — ${answered(step.answer)}`];
    case "error":
      return [`! ${step.text}`];
  }
}

/** A turn's blocks, one line each: id, title, how many ops, and whether it is undone now. */
export function blockLines(turn: Turn, undos: readonly UndoRecord[]): string[] {
  if (!turn.blocks.length) return [];
  const rows = turn.blocks.map((b: Block) => [b.id, b.title || "(untitled)", `${b.ops.length} op${b.ops.length === 1 ? "" : "s"}`, blockUndone(undos, b.id) ? "undone" : ""]);
  return ["changes:", ...table(rows).map((l) => `  ${l}`)];
}

const when = (iso: string): string => iso.slice(0, 16).replace("T", " ");

/** A whole chat as text: the person's turns, then what the assistant did, step by step. */
export function transcriptLines(read: ChatRead): string[] {
  const { chat } = read;
  const grants = Object.entries(grantsOf(chat)).map(([v, g]) => `${v}=${g.mode}`);
  const out = [`# ${chat.title}  (${chat.id})`, `${chat.provider}/${chat.model}${chat.effort ? ` · ${chat.effort}` : ""} · ${chat.mode} · vault ${read.vault}${grants.length ? ` · reaches ${grants.join(", ")}` : ""}`];
  const turns = read.live ? [...read.turns, read.live] : read.turns;
  for (const t of turns) {
    out.push("", `## you  ${when(t.at)}`, ...t.text.split("\n"));
    out.push("", `## ${t.model} · ${t.mode}  ${t.status}${t.device && t.device !== read.device ? `  (from ${t.device})` : ""}  [${t.id}]`);
    for (const s of t.steps) out.push(...stepLines(s));
    const blocks = blockLines(t, read.undos);
    if (blocks.length) out.push("", ...blocks);
  }
  return out;
}

/** What an undo or a redo could not do, one line per thing. */
export function conflictLines(record: UndoRecord): string[] {
  return record.conflicts.map((c) => `conflict: ${c.what} (${c.vault}) — ${c.why}${c.paths.length ? `: ${c.paths.join(", ")}` : ""}`);
}

/* ---- the commands ------------------------------------------------------------------------------ */

const FLAGS = {
  provider: { name: "provider", type: "string", value: "claude|opencode", help: "which harness answers" },
  model: { name: "model", type: "string", value: "<model>", help: "the model, as `anydag chat models` lists it" },
  effort: { name: "effort", type: "string", value: "<level>", help: "how hard it thinks; `default` is the model's own" },
  mode: { name: "mode", type: "string", value: "ask|edit", help: "`ask` only reads; `edit` may change the vault" },
} as const;

async function chatOf(ctx: Ctx, id: string): Promise<ChatRead> {
  return ctx.api.get<ChatRead>("/__board/chat", { id });
}

/** Ask on the terminal, and send the answer. */
async function askAbout(ctx: Ctx, chat: string, step: Extract<Step, { kind: "approval" | "access" }>): Promise<void> {
  const question = stepLines(step)[0]!.replace(/ — waiting for an answer$/, "");
  const said = (await ctx.io.ask(`${question}  allow? [y/N] `)).trim().toLowerCase();
  await ctx.api.post("/__board/chat/approve", { id: chat, step: step.id, yes: said === "y" || said === "yes" });
}

/**
 * Follow a turn until it ends. Deltas are printed as they arrive and each tool call on a line of its
 * own; a step that is updated (a tool's result, an approval's answer) is the same `index` again.
 * Returns the turn the server finished with.
 */
async function follow(ctx: Ctx, chat: string, turnId: string, next: () => Promise<IteratorResult<{ event: string; data: string }>>): Promise<Turn> {
  const shown = new Set<number>();
  let typed = false;
  let midline = false;
  const line = (text: string) => {
    if (midline) ctx.io.write("\n");
    midline = false;
    ctx.io.out(text);
  };
  for (;;) {
    const step = await next();
    if (step.done) throw new UsageError("the event feed closed before the turn ended — `anydag chat cat` says where it got to");
    const got = step.value;
    if (!got.event.startsWith("chat:")) continue;
    let e: ChatEvent;
    try {
      e = JSON.parse(got.data) as ChatEvent;
    } catch {
      continue;
    }
    if (ctx.json) {
      ctx.io.out(JSON.stringify(e));
      if (e.type === "end" && e.turn.id === turnId) return e.turn;
      continue;
    }
    switch (e.type) {
      case "delta":
        if (e.turn !== turnId) break;
        typed = true;
        midline = !e.text.endsWith("\n");
        ctx.io.write(e.text);
        break;
      case "step": {
        if (e.turn !== turnId) break;
        const first = !shown.has(e.index);
        shown.add(e.index);
        const s = e.step;
        if (s.kind === "text") {
          if (typed) {
            typed = false;
            if (midline) ctx.io.write("\n");
            midline = false;
          } else if (first) line(s.text);
        } else if (s.kind === "tool") {
          if (first) line(stepLines(s)[0]!);
          else if (s.error) line(`  ✗ ${s.name} failed${s.output ? `: ${oneLine(s.output, 160)}` : ""}`);
        } else if (s.kind === "approval" || s.kind === "access") {
          if (s.answer !== null) line(stepLines(s)[0]!);
          else if (ctx.io.stdinIsTTY) {
            if (midline) ctx.io.write("\n");
            midline = false;
            await askAbout(ctx, chat, s);
          } else {
            line(stepLines(s)[0]!);
            ctx.io.err(`answer with: anydag chat approve ${chat} ${s.id} yes|no`);
          }
        } else if (first) line(stepLines(s)[0]!);
        break;
      }
      case "end":
        if (e.turn.id !== turnId) break;
        if (midline) ctx.io.write("\n");
        return e.turn;
      default:
        break;
    }
  }
}

export const CHAT: Command[] = [
  {
    name: ["chat", "ls"],
    args: "",
    summary: "the chats in this vault, newest first — --all for every open vault",
    flags: [{ name: "all", type: "boolean", help: "every open vault, not only this one" }],
    routes: ["GET /__board/chats"],
    async run(ctx, p) {
      const got = await ctx.api.get<{ chats: ChatRow[] }>("/__board/chats", bool(p, "all") ? { all: "1" } : undefined);
      emit(ctx, got, () => {
        if (!got.chats.length) return ctx.io.err("no chats yet — `anydag chat new` starts one");
        for (const l of rowLines(got.chats)) ctx.io.out(l);
      });
    },
  },
  {
    name: ["chat", "models"],
    args: "",
    summary: "the providers a chat can run on, whether each is available, and the models and effort levels it takes",
    routes: ["GET /__board/chat/models"],
    async run(ctx) {
      const got = await ctx.api.get<ModelsList & { providers: { label: string; why?: string; efforts: string[] }[] }>("/__board/chat/models");
      emit(ctx, got, () => {
        for (const pr of got.providers) {
          ctx.io.out(`${pr.provider}  ${pr.label}  ${pr.available ? "available" : `unavailable${pr.why ? ` — ${pr.why}` : ""}`}`);
          ctx.io.out(`  efforts: ${pr.efforts.map((x) => x || "default").join(" ")}`);
          for (const m of pr.models) ctx.io.out(`  ${m.id}${m.id === pr.default ? "  (default)" : ""}`);
        }
      });
    },
  },
  {
    name: ["chat", "new"],
    args: "",
    summary: "start a chat and print its id",
    help: "With no --provider it is the first the server can run, on that provider's default model. A chat starts in `ask` mode, which only reads.",
    flags: [FLAGS.provider, FLAGS.model, FLAGS.effort, FLAGS.mode, { name: "title", type: "string", value: "<title>", help: "what it is called" }],
    routes: ["GET /__board/chat/models", "POST /__board/chat"],
    async run(ctx, p) {
      const models = await ctx.api.get<ModelsList>("/__board/chat/models");
      const on = startOn(models, providerOf(str(p, "provider")), str(p, "model"));
      const effort = str(p, "effort");
      const done = await ctx.api.post<{ chat: { id: string } }>("/__board/chat", {
        ...on,
        ...(effort && effort !== "default" ? { effort } : {}),
        mode: modeOf(str(p, "mode")),
        title: str(p, "title"),
      });
      emit(ctx, done, () => ctx.io.out(done.chat.id));
    },
  },
  {
    name: ["chat", "cat"],
    args: "<id>",
    min: 1,
    summary: "a chat as text: what was asked, what the assistant did step by step, and the changes it made",
    help: "A tool call is one line, `→ name`. Each turn's changes list the block id, title, how many ops and whether it is undone — the ids `chat undo` takes.",
    routes: ["GET /__board/chat"],
    async run(ctx, p) {
      const read = await chatOf(ctx, p.pos[0]!);
      emit(ctx, read, () => {
        for (const l of transcriptLines(read)) ctx.io.out(l);
      });
    },
  },
  {
    name: ["chat", "say"],
    args: "<id> <words…>",
    min: 1,
    summary: "send a turn and follow the answer as it is written; exit 1 if the turn failed",
    help:
      "Prints the assistant's words as they arrive and each tool call on a line of its own. A write that waits for a person is asked on the " +
      "terminal when there is one; without one it is printed with the `chat approve` that answers it. Ctrl-C stops the turn. " +
      "The words are the rest of the line, or --file <path> (`--file -` is stdin); stdin is never read unless it is named. " +
      "--provider, --model, --effort and --mode change what this chat is sent to from now on. --json prints each event as a line.",
    flags: [FLAGS.provider, FLAGS.model, FLAGS.effort, FLAGS.mode, { name: "file", type: "string", value: "<path|->", help: "the words, from a file; `-` is stdin" }],
    routes: ["POST /__board/chat/turn", "GET /__board/chat/events", "POST /__board/chat/approve", "POST /__board/chat/stop"],
    async run(ctx, p) {
      const id = p.pos[0]!;
      const words = p.pos.slice(1).join(" ").trim();
      const file = str(p, "file");
      if (words && file) throw new UsageError("give the words on the line or with --file, not both");
      const text = (words || (await readText(ctx, file, "what to say"))).trim();
      if (!text) throw new UsageError("there is nothing to say");
      const effort = str(p, "effort");
      const change = {
        provider: providerOf(str(p, "provider")),
        model: str(p, "model"),
        effort: effort === "default" ? null : effort,
        mode: modeOf(str(p, "mode")),
      };

      /* Subscribe first; the stream holds what arrives while the turn is being sent. */
      const feed = await ctx.api.raw("/__board/chat/events", { query: { id }, headers: { accept: "text/event-stream" } });
      const it = events(feed)[Symbol.asyncIterator]();
      let stopping = false;
      const interrupt = () => {
        if (stopping) return;
        stopping = true;
        ctx.io.err("stopping…");
        void ctx.api.post("/__board/chat/stop", { id }).catch(() => undefined);
      };
      process.on("SIGINT", interrupt);
      try {
        const sent = await ctx.api.post<{ turn: Turn }>("/__board/chat/turn", { id, text, ...change });
        const end = await follow(ctx, id, sent.turn.id, () => it.next());
        if (!ctx.json) ctx.io.err(`${end.status}${end.usage?.cost !== undefined ? ` · $${end.usage.cost.toFixed(4)}` : ""}`);
        if (!ctx.json) {
          const read = await chatOf(ctx, id);
          for (const l of blockLines(end, read.undos)) ctx.io.out(l);
          if (end.blocks.length) ctx.io.err(`undo one with: anydag chat undo ${id} ${end.id} <block>`);
        }
        if (end.status === "failed") {
          for (const s of end.steps) if (s.kind === "error") ctx.io.err(`! ${s.text}`);
          return EXIT.failed;
        }
      } finally {
        process.off("SIGINT", interrupt);
        await it.return?.(undefined);
      }
    },
  },
  {
    name: ["chat", "stop"],
    args: "<id>",
    min: 1,
    summary: "stop the turn that is answering",
    routes: ["POST /__board/chat/stop"],
    async run(ctx, p) {
      const done = await ctx.api.post("/__board/chat/stop", { id: p.pos[0] });
      emit(ctx, done, () => ctx.io.err("stopped"));
    },
  },
  {
    name: ["chat", "approve"],
    args: "<id> <step> yes|no",
    min: 3,
    summary: "answer a write or a vault request the assistant is waiting on — `chat cat` shows its step id",
    routes: ["POST /__board/chat/approve"],
    async run(ctx, p) {
      const done = await ctx.api.post("/__board/chat/approve", { id: p.pos[0], step: p.pos[1], yes: answerOf(p.pos[2]!) });
      emit(ctx, done, () => ctx.io.err(answerOf(p.pos[2]!) ? "allowed" : "refused"));
    },
  },
  {
    name: ["chat", "grant"],
    args: "<id> <vault> [ask|edit|off]",
    min: 2,
    summary: "let a chat reach another vault — read it (`ask`, the default), change it (`edit`), or take the grant back (`off`)",
    help: "<vault> is a vault id from `anydag vault ls`. A chat always reaches the vault it lives in.",
    routes: ["POST /__board/chat/grant"],
    async run(ctx, p) {
      const mode = grantMode(p.pos[2]);
      const done = await ctx.api.post<{ chat: unknown }>("/__board/chat/grant", { id: p.pos[0], vault: p.pos[1], mode });
      emit(ctx, done, () => ctx.io.err(mode ? `${p.pos[0]} may ${mode === "ask" ? "read" : "change"} ${p.pos[1]}` : `${p.pos[0]} no longer reaches ${p.pos[1]}`));
    },
  },
  ...(["undo", "redo"] as const).map(
    (verb): Command => ({
      name: ["chat", verb],
      args: "<id> <turn> <block>",
      min: 3,
      summary: verb === "undo" ? "take back one block of changes a turn made" : "put back a block that was undone",
      help:
        "Only a chat that is not answering. A file that changed since, or that is no longer there, is left alone and printed as a conflict " +
        "(exit 3); everything else in the block is still undone.",
      routes: [`POST /__board/chat/${verb}`],
      async run(ctx, p) {
        const done = await ctx.api.post<{ record: UndoRecord }>(`/__board/chat/${verb}`, { id: p.pos[0], turn: p.pos[1], block: p.pos[2] });
        emit(ctx, done, () => {
          ctx.io.err(`${verb === "undo" ? "undone" : "redone"} ${p.pos[2]}`);
          for (const l of conflictLines(done.record)) ctx.io.err(l);
        });
        return done.record.conflicts.length ? EXIT.conflict : EXIT.ok;
      },
    }),
  ),
  {
    name: ["chat", "rename"],
    args: "<id> <title…>",
    min: 2,
    summary: "give a chat a title",
    routes: ["POST /__board/chat/rename"],
    async run(ctx, p) {
      const done = await ctx.api.post<{ chat: { title: string } }>("/__board/chat/rename", { id: p.pos[0], title: p.pos.slice(1).join(" ") });
      emit(ctx, done, () => ctx.io.out(done.chat.title));
    },
  },
  {
    name: ["chat", "rm"],
    args: "<id>",
    min: 1,
    summary: "delete a chat and its turns — it asks first",
    help: "--yes does not ask, and is needed without a terminal.",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["POST /__board/chat/delete"],
    async run(ctx, p: Parsed) {
      await confirm(ctx, `delete chat ${p.pos[0]} and everything said in it?`, bool(p, "yes"));
      const done = await ctx.api.post("/__board/chat/delete", { id: p.pos[0] });
      emit(ctx, done, () => ctx.io.err(`deleted ${p.pos[0]}`));
    },
  },
];
