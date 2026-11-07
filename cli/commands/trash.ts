import { UsageError, bool } from "../args";
import { confirm, emit, table, type Command, type Ctx } from "../context";

/**
 * The trash, from a terminal.
 *
 * Every `rm` here moves a thing to the trash, where it stays for the vault's days (ANYDAG_TRASH_DAYS) with its id
 * and its images; these four are what is done to it then. An entry is named by its
 * id or by the name the thing had, so `anydag board rm plan` and `anydag trash restore plan` are a
 * pair — and when the trash holds two things that were `plan`, the ids are what tells them apart.
 */

/** One entry, as `GET /__board/trash` says it. */
interface TrashEntry {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  deleted: string;
  expires: string;
  doc: string | null;
  holds: Record<string, string[]> | null;
}

interface TrashList {
  days: number;
  entries: TrashEntry[];
}

const DAY = 86_400_000;

/** Days until it goes for good, counted up — thirty the moment it is deleted, one on its last day. */
const daysLeft = (expires: string, now = Date.now()): number => Math.max(0, Math.ceil((Date.parse(expires) - now) / DAY));

/** What a folder entry held, counted: `3 files, 1 folder`. */
function held(e: TrashEntry): string {
  if (!e.holds) return "";
  const files = ["boards", "notes", "quizzes", "tables", "files"].reduce((n, k) => n + (e.holds?.[k]?.length ?? 0), 0);
  const folders = Math.max(0, (e.holds.folders?.length ?? 1) - 1);
  return [files ? `${files} file${files === 1 ? "" : "s"}` : "", folders ? `${folders} folder${folders === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") || "empty";
}

/** The entry an argument names: its id, or the name the thing had — refused when that names two. */
async function entryFor(ctx: Ctx, said: string): Promise<TrashEntry> {
  const { entries } = await ctx.api.get<TrashList>("/__board/trash");
  const byId = entries.find((e) => e.id === said);
  if (byId) return byId;
  const named = entries.filter((e) => e.name === said.replace(/\/+$/, ""));
  if (named.length === 1) return named[0]!;
  if (named.length > 1) throw new UsageError(`${named.length} things in the trash were \`${said}\` — name one by its id: ${named.map((e) => e.id).join(", ")}`);
  throw new UsageError(`nothing in the trash is \`${said}\` — \`anydag trash ls\` says what is`);
}

export const TRASH: Command[] = [
  {
    name: ["trash", "ls"],
    args: "",
    summary: "what is in the trash, newest first, and how long each has before it is gone for good",
    routes: ["GET /__board/trash"],
    async run(ctx) {
      const got = await ctx.api.get<TrashList>("/__board/trash");
      emit(ctx, got, () => {
        if (!got.entries.length) return ctx.io.err(`the trash is empty — what is deleted stays there for ${got.days} days`);
        const rows = got.entries.map((e) => {
          const left = daysLeft(e.expires);
          const what = e.kind === "folder" ? `${e.name}/ (${held(e)})` : e.title && e.title !== e.name ? `${e.name} (${e.title})` : e.name;
          return [e.id, e.kind, e.deleted.slice(0, 10), left ? `${left} day${left === 1 ? "" : "s"} left` : "goes today", what];
        });
        for (const line of table(rows)) ctx.io.out(line);
      });
    },
  },
  {
    name: ["trash", "restore"],
    args: "<id-or-name>",
    min: 1,
    summary: "put something back where it was, with its id — numbered if its name was taken since",
    routes: ["GET /__board/trash", "POST /__board/trash/restore"],
    async run(ctx, p) {
      const entry = await entryFor(ctx, p.pos[0]!);
      const back = await ctx.api.post<TrashEntry>("/__board/trash/restore", { id: entry.id });
      emit(ctx, back, () => {
        ctx.io.out(back.name);
        if (back.name !== entry.name) ctx.io.err(`${entry.name} was taken since, so it is back as ${back.name}`);
      });
    },
  },
  {
    name: ["trash", "rm"],
    args: "<id-or-name>",
    min: 1,
    summary: "delete one thing in the trash for good — there is no way back from this",
    help: "--yes does not ask, and is needed without a terminal.",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["GET /__board/trash", "POST /__board/trash/delete"],
    async run(ctx, p) {
      const entry = await entryFor(ctx, p.pos[0]!);
      await confirm(ctx, `delete ${entry.kind} ${entry.name} for good?`, bool(p, "yes"));
      const done = await ctx.api.post("/__board/trash/delete", { id: entry.id });
      emit(ctx, done, () => ctx.io.err(`deleted ${entry.name} for good`));
    },
  },
  {
    name: ["trash", "empty"],
    args: "",
    summary: "delete everything in the trash for good — there is no way back from this",
    help: "--yes does not ask, and is needed without a terminal.",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["GET /__board/trash", "POST /__board/trash/empty"],
    async run(ctx, p) {
      const { entries } = await ctx.api.get<TrashList>("/__board/trash");
      if (!entries.length) {
        emit(ctx, { ids: [] }, () => ctx.io.err("the trash is already empty"));
        return;
      }
      await confirm(ctx, `delete the ${entries.length} thing${entries.length === 1 ? "" : "s"} in the trash for good?`, bool(p, "yes"));
      const done = await ctx.api.post<{ ids: string[] }>("/__board/trash/empty");
      emit(ctx, done, () => ctx.io.err(`deleted ${done.ids.length} thing${done.ids.length === 1 ? "" : "s"} for good`));
    },
  },
];
