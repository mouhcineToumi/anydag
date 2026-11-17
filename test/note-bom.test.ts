// @vitest-environment jsdom
/**
 * A note that starts with a byte-order mark, and a note whose lines end in CRLF (#394, #416).
 *
 * remark drops a leading U+FEFF and counts its offsets from the text after it, so a span map sliced
 * from the text with the mark in it was one code unit out: every unit lost its last character to
 * the next one's gap, and the first edit wrote that gap back as `\n\n` — the period at the end of
 * the block before the edited one was gone, and in a note with frontmatter, the closing `---` lost
 * a hyphen. Each case here goes the page's own way: `splitNote`, `load`, a real editor, `settle`,
 * one block typed into, `saved`, `joinNote`, and the exact bytes that come out.
 */
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { describe, expect, it } from "vitest";

import { eventOf, withEvent } from "@/note/event";
import { joinNote, splitNote } from "@/note/format";
import { load, type NoteBlock, saved, settle } from "@/note/markdown";
import { projectOf, withProject } from "@/note/project";
import { noteSchema } from "@/note/schema";
import { tagsOf, withTags } from "@/note/tags";
import { taskFactsOf, taskOf, withTask } from "@/note/task";
import { fillTemplate } from "@/note/template";
import { titleOf } from "@/refs/extract";
import { changeOf, relinkText } from "@/refs/relink";
import type { WikiCandidate } from "@/refs/wikilinks";
import { withoutTitle, withTitle } from "../server/frontmatter";
import { frontId, withId } from "../server/ids";

const BOM = "\uFEFF";

const server = ServerBlockNoteEditor.create({ schema: noteSchema });
const editor = server.editor;

/** Put blocks into the editor and read back what it actually holds. */
const hold = (blocks: NoteBlock[]): Promise<NoteBlock[]> =>
  server._withDOM(async () => {
    editor.replaceBlocks(editor.document, (blocks.length ? blocks : [{ type: "paragraph" }]) as never);
    return JSON.parse(JSON.stringify(editor.document)) as NoteBlock[];
  });

/** `" X"` typed at the end of a block, the way BlockNote holds it after the keystrokes. */
function typed(block: NoteBlock, more = " X"): NoteBlock {
  const content = Array.isArray(block.content) ? [...block.content] : [];
  const last = content[content.length - 1];
  if (last?.type === "text") content[content.length - 1] = { ...last, text: last.text + more };
  else content.push({ type: "text", text: more.trimStart(), styles: {} });
  return { ...block, content };
}

/** The editor's blocks with `more` typed at the end of the one at `at`. */
const typedAt = (doc: NoteBlock[], at: number, more = " X"): NoteBlock[] => doc.map((b, i) => (i === at ? typed(b, more) : b));

/** The first block made a paragraph — a heading turned into text from the block menu. */
const flattened = (doc: NoteBlock[]): NoteBlock[] => [{ ...doc[0], type: "paragraph", props: {} }, ...doc.slice(1)];

/** A note opened the way the page opens one: the frontmatter off, the body loaded into an editor. */
async function open(text: string) {
  const f = splitNote(text);
  const { blocks, loaded } = load(f.body);
  const doc = await hold(blocks);
  return { front: f.front, title: f.title, doc, loaded: settle(loaded, doc) };
}

/** The file after typing into the block at `at` — and the state the next save is measured against. */
async function edit(text: string, at: number, more = " X"): Promise<string> {
  const { front, doc, loaded } = await open(text);
  return joinNote(front, saved(loaded, typedAt(doc, at, more)).body);
}

describe("a note that starts with a byte-order mark", () => {
  const two = `${BOM}First paragraph.\n\nSecond paragraph.\n`;
  const three = `${BOM}Alpha line one.\n\nBravo line two.\n\nCharlie line three.\n`;
  const heading = `${BOM}# Heading\n\nFirst paragraph.\n\nSecond paragraph.\n`;

  it("keeps every byte, the mark included, when nothing was touched", async () => {
    for (const text of [two, three, heading, `${BOM}---\ntitle: Kept\n---\nBody.\n`, BOM, `${BOM}\n\nAfter blank lines.\n`]) {
      const { front, doc, loaded } = await open(text);
      expect(joinNote(front, saved(loaded, doc).body)).toBe(text);
    }
  });

  it("rewrites only the last block when the last block is typed into", async () => {
    expect(await edit(two, 1)).toBe(`${BOM}First paragraph.\n\nSecond paragraph. X\n`);
    expect(await edit(three, 2)).toBe(`${BOM}Alpha line one.\n\nBravo line two.\n\nCharlie line three. X\n`);
  });

  it("rewrites only a middle block when a middle block is typed into", async () => {
    expect(await edit(three, 1)).toBe(`${BOM}Alpha line one.\n\nBravo line two. X\n\nCharlie line three.\n`);
  });

  it("keeps the mark in front of the first block when the first block is typed into", async () => {
    expect(await edit(two, 0)).toBe(`${BOM}First paragraph. X\n\nSecond paragraph.\n`);
    expect(await edit(three, 0)).toBe(`${BOM}Alpha line one. X\n\nBravo line two.\n\nCharlie line three.\n`);
  });

  it("keeps a heading before the edited block whole", async () => {
    expect(await edit(heading, 1)).toBe(`${BOM}# Heading\n\nFirst paragraph. X\n\nSecond paragraph.\n`);
    expect(await edit(heading, 2)).toBe(`${BOM}# Heading\n\nFirst paragraph.\n\nSecond paragraph. X\n`);
    expect(await edit(heading, 0)).toBe(`${BOM}# Heading X\n\nFirst paragraph.\n\nSecond paragraph.\n`);
  });

  it("loses nothing over three edits in a row, each measured against the save before it", async () => {
    const { front, doc, loaded } = await open(three);
    let map = loaded;
    let blocks = doc;
    const files: string[] = [];
    for (const [at, more] of [
      [1, " one"],
      [0, " two"],
      [2, " three"],
    ] as const) {
      blocks = typedAt(blocks, at, more);
      const next = saved(map, blocks);
      map = settle(next.loaded, blocks);
      files.push(joinNote(front, next.body));
    }
    expect(files).toEqual([
      `${BOM}Alpha line one.\n\nBravo line two. one\n\nCharlie line three.\n`,
      `${BOM}Alpha line one. two\n\nBravo line two. one\n\nCharlie line three.\n`,
      `${BOM}Alpha line one. two\n\nBravo line two. one\n\nCharlie line three. three\n`,
    ]);
  });

  it("keeps the mark first when a block is put above the first one", async () => {
    const { front, doc, loaded } = await open(two);
    const top: NoteBlock = { id: "new", type: "paragraph", content: [{ type: "text", text: "On top.", styles: {} }] };
    expect(joinNote(front, saved(loaded, [top, ...doc]).body)).toBe(`${BOM}On top.\n\nFirst paragraph.\n\nSecond paragraph.\n`);
  });

  it("maps the bytes right when the body is loaded with the mark still on it", async () => {
    /* Not the page's way — `splitNote` takes the mark off first — but `load` must not depend on it. */
    const { blocks, loaded } = load(three);
    const doc = await hold(blocks);
    const map = settle(loaded, doc);
    expect(map.units.map((u) => u.source)).toEqual(["Alpha line one.", "Bravo line two.", "Charlie line three."]);
    expect(saved(map, doc).body).toBe(three);
    expect(saved(map, typedAt(doc, 1)).body).toBe(`${BOM}Alpha line one.\n\nBravo line two. X\n\nCharlie line three.\n`);
    expect(saved(map, typedAt(doc, 0)).body).toBe(`${BOM}Alpha line one. X\n\nBravo line two.\n\nCharlie line three.\n`);
  });
});

describe("a note that starts with a byte-order mark and frontmatter", () => {
  const one = `${BOM}---\ntitle: Bom front\ntags: [x]\n---\nBody text.\n`;
  const two = `${BOM}---\ntitle: Second bom\ntags: [y]\n---\nFirst body.\n\nSecond body.\n`;

  it("reads the frontmatter as frontmatter, the mark carried with it", () => {
    const f = splitNote(two);
    expect(f.title).toBe("Second bom");
    expect(f.front).toBe(`${BOM}---\ntitle: Second bom\ntags: [y]\n---\n`);
    expect(f.body).toBe("First body.\n\nSecond body.\n");
    expect(joinNote(f.front, f.body)).toBe(two);
  });

  it("carries the mark in front of a body with no frontmatter, so the editor never holds it", () => {
    expect(splitNote(`${BOM}# Just a body\n`)).toEqual({ front: BOM, body: "# Just a body\n" });
  });

  it("keeps the frontmatter whole when its only block is typed into", async () => {
    expect(await edit(one, 0)).toBe(`${BOM}---\ntitle: Bom front\ntags: [x]\n---\nBody text. X\n`);
  });

  it("rewrites only the block typed into, first or last", async () => {
    expect(await edit(two, 1)).toBe(`${BOM}---\ntitle: Second bom\ntags: [y]\n---\nFirst body.\n\nSecond body. X\n`);
    expect(await edit(two, 0)).toBe(`${BOM}---\ntitle: Second bom\ntags: [y]\n---\nFirst body. X\n\nSecond body.\n`);
  });

  const task = `${BOM}---\ntitle: Ship it\nstatus: todo\nproject: active\nstart: 2026-11-20\ntags: [work]\nid: abcdefghjk\n---\n- [x] one\n- [ ] two\n`;

  it("is read for what it says: a task, a project, an event, tags, a title, an id", () => {
    expect(taskOf(task)?.status).toBe("todo");
    expect(projectOf(task)?.status).toBe("active");
    /* A note with a `status:` is a task, never an event: the event is read off one without it. */
    expect(eventOf(task.replace("status: todo\n", ""))?.start).toBe("2026-11-20");
    expect(tagsOf(task)).toEqual(["work"]);
    expect(titleOf(task)).toBe("Ship it");
    expect(frontId(task)).toBe("abcdefghjk");
    expect(taskFactsOf(task)).toEqual({ items: { done: 1, total: 2 }, body: true });
  });

  it("is written one line at a time, the mark kept first and once", () => {
    expect(withTask(task, { status: "done" })).toBe(task.replace("status: todo", "status: done"));
    expect(withProject(task, { project: "paused" })).toBe(task.replace("project: active", "project: paused"));
    expect(withEvent(task, { start: "2026-11-21" })).toBe(task.replace("start: 2026-11-20", "start: 2026-11-21"));
    expect(withTags(task, { add: ["home"] })).toBe(task.replace("tags: [work]", "tags: [work, home]"));
    expect(withTitle(task, "Shipped", "note")).toBe(task.replace("title: Ship it", "title: Shipped"));
    expect(withoutTitle(task)).toBe(task.replace("title: Ship it\n", ""));
    expect(withId(task, "zyxwvtsrqp")).toBe(task.replace("id: abcdefghjk", "id: zyxwvtsrqp"));
  });

  it("grows behind the mark, not in front of it, on a note that had none", () => {
    const bare = `${BOM}Body.\n`;
    expect(withTask(bare, { status: "todo" })).toBe(`${BOM}---\nstatus: todo\n---\nBody.\n`);
    expect(withTags(bare, { add: ["a"] })).toBe(`${BOM}---\ntags: [a]\n---\nBody.\n`);
    expect(withTitle(bare, "Named", "note")).toBe(`${BOM}---\ntitle: Named\n---\nBody.\n`);
    expect(withId(bare, "abcdefghjk")).toBe(`${BOM}---\nid: abcdefghjk\n---\nBody.\n`);
    /* And the frontmatter the page holds for such a note — the mark alone — grows the same way. */
    expect(withTask(splitNote(bare).front, { status: "todo" })).toBe(`${BOM}---\nstatus: todo\n---\n`);
  });

  it("takes the whole block away, and keeps the mark, when the last key goes", () => {
    expect(withTags(`${BOM}---\ntags: [a]\n---\nBody.\n`, { remove: ["a"] })).toBe(`${BOM}Body.\n`);
    expect(withoutTitle(`${BOM}---\ntitle: Gone\n---\nBody.\n`)).toBe(`${BOM}Body.\n`);
  });

  it("is filled as a template, the mark kept", () => {
    const at = Date.UTC(2026, 10, 17, 9, 30);
    const vars = { title: "a: b", at, zone: "UTC" };
    const template = "---\ntitle: {{title}}\n---\n# {{title}}\n";
    expect(fillTemplate(`${BOM}${template}`, vars)).toBe(`${BOM}${fillTemplate(template, vars)}`);
    expect(fillTemplate(template, vars)).toBe('---\ntitle: "a: b"\n---\n# a: b\n');
  });
});

describe("a rename in a note that starts with a byte-order mark", () => {
  const doc = (id: string, name: string): WikiCandidate => ({ id, name, kind: "note", title: name });

  it("rewrites the link where it is, not one character early", () => {
    const change = changeOf([doc("plan000001", "Plan")], [doc("plan000001", "Budget")]);
    expect(change).not.toBeNull();
    const text = `${BOM}See [[Plan]] and [[Plan|the plan]]\n`;
    expect(relinkText(text, "note", change!).text).toBe(`${BOM}See [[Budget]] and [[Budget|the plan]]\n`);
    const fronted = `${BOM}---\ntitle: T\n---\nSee [[Plan]].\n`;
    expect(relinkText(fronted, "note", change!).text).toBe(`${BOM}---\ntitle: T\n---\nSee [[Budget]].\n`);
  });
});

/*
 * #416: editing one block of a CRLF note wrote the gaps on either side of it as `\n\n`, so the block
 * before it — untouched — lost its CRLF, and the file ended up with both line endings.
 */
describe("a note whose lines end in CRLF", () => {
  const text = "# Head one\r\n\r\nA paragraph.\r\n\r\n## Head two\r\n\r\nLast.\r\n";

  it("keeps the line endings around a block that was typed into", async () => {
    expect(await edit(text, 1)).toBe("# Head one\r\n\r\nA paragraph. X\r\n\r\n## Head two\r\n\r\nLast.\r\n");
    expect(await edit(text, 0)).toBe("# Head one X\r\n\r\nA paragraph.\r\n\r\n## Head two\r\n\r\nLast.\r\n");
    expect(await edit(text, 3)).toBe("# Head one\r\n\r\nA paragraph.\r\n\r\n## Head two\r\n\r\nLast. X\r\n");
  });

  it("keeps them under a CRLF frontmatter", async () => {
    const fronted = "---\r\ntitle: t\r\ntags: [a]\r\n---\r\n# A heading\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.\r\n";
    expect(await edit(fronted, 1)).toBe(
      "---\r\ntitle: t\r\ntags: [a]\r\n---\r\n# A heading\r\n\r\nFirst paragraph. X\r\n\r\nSecond paragraph.\r\n",
    );
  });

  it("writes a blank line where the gap held none and the block was rewritten, so two blocks never run together", async () => {
    /* A heading needs no blank line under it; a paragraph does, or the next line joins it. */
    const lf = await open("# Title\nPara.\n");
    expect(joinNote(lf.front, saved(lf.loaded, flattened(lf.doc)).body)).toBe("Title\n\nPara.\n");
    const crlf = await open("# Title\r\nPara.\r\n");
    expect(joinNote(crlf.front, saved(crlf.loaded, flattened(crlf.doc)).body)).toBe("Title\r\n\r\nPara.\r\n");
  });
});
