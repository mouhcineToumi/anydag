/**
 * Note templates: the notes in the vault's templates folder, and a new note made from one.
 *
 * A template is an ordinary note — the folder is Settings' `dag:templates`, or `Templates` when that
 * exists (`Vault.templatesFolder`), and nothing here ever makes it. **Making a note from one fills
 * its variables once** (`src/note/template.ts`) and files the text the way `/create` files any
 * text: the title verbatim in the folder asked for, numbered if taken. The new note is a plain note
 * after that. The starters are written only by their own route, only when asked, and never over a
 * file that is there.
 */

import type { Hono } from "hono";

import { eventOf } from "../../src/note/event";
import { UNTITLED, cleanTitle } from "../../src/note/format";
import { STARTERS } from "../../src/note/starters";
import { taskOf } from "../../src/note/task";
import { TEMPLATES_DEFAULT, fillTemplate, inTemplates } from "../../src/note/template";
import type { Session } from "../context";
import { withTitle } from "../frontmatter";
import { bodyOf, err, mustRead } from "../http";
import { withId } from "../ids";
import { leafOf } from "../names";
import { Refused } from "../vault";
import { titled, zoneOf } from "./docs";

/** What a template makes: a note, or a note that is a task or an event by the line it carries. */
type Makes = "note" | "task" | "event";

const makes = (text: string): Makes => (taskOf(text) ? "task" : eventOf(text) ? "event" : "note");

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A folder the note is filed in, as `/create` reads a name's folder: no slashes at the ends, nothing outside the vault. */
function folderArg(raw: unknown): string {
  const folder = str(raw)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (folder.split("/").some((part) => part === ".." || part === "."))
    throw err(400, "`folder` has to be a folder inside the vault");
  return folder;
}

export function templateRoutes(app: Hono, s: Session): void {
  app.get("/__board/templates", async (c) => {
    const folder = s.vault.templatesFolder();
    const tree = await s.vault.tree();
    const names = folder ? tree.notes.filter((n) => inTemplates(n, folder)) : [];
    const templates = [];
    const now = new Date();
    const zone = zoneOf(s);
    for (const name of names) {
      const v = await s.vault.read(name, "note");
      if (!v) continue;
      /* What it makes is read off the text as it would be filled: a `start: {{date}}` is no date until it is. */
      const filled = fillTemplate(v.text, { title: UNTITLED, at: now, zone });
      templates.push({ name, title: tree.titles[name] ?? leafOf(name), makes: makes(filled) });
    }
    templates.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }) || (a.name < b.name ? -1 : 1));
    return c.json({ folder, configured: s.vault.templates !== "", templates });
  });

  app.post("/__board/from-template", async (c) => {
    const body = await bodyOf(c);
    const template = str(body.template).trim();
    const folder = s.vault.templatesFolder();
    if (!template || !inTemplates(template, folder)) throw err(404, `no template \`${template}\``);
    const source = await mustRead(s.vault, template, "note").catch(() => {
      throw err(404, `no template \`${template}\``);
    });
    const given = cleanTitle(str(body.title)) ?? "";
    const into = folderArg(body.folder);
    /* Filled once; the id is the template's own, so the note takes a new one. */
    let text = withId(fillTemplate(source.text, { title: given || UNTITLED, at: new Date(), zone: zoneOf(s) }), null);
    if (given) text = withTitle(text, given, "note");
    const asked = titled(into ? `${into}/${UNTITLED}` : UNTITLED, text);
    let settled: string;
    try {
      settled = await s.vault.create(asked.name, "note", asked.text);
    } catch (e) {
      if (e instanceof Refused) throw err(400, e.message);
      throw e;
    }
    const v = await mustRead(s.vault, settled, "note");
    return c.json({ name: settled, id: await s.vault.peekId(settled, "note"), base: v.base, text: v.text, template });
  });

  app.post("/__board/templates/starters", async (c) => {
    const folder = s.vault.templatesFolder() ?? TEMPLATES_DEFAULT;
    /* One namespace for every kind: a `Meeting.board.md` already answers to `Meeting`. */
    const tree = await s.vault.tree();
    const taken = new Set(
      [...tree.boards, ...tree.notes, ...tree.quizzes, ...tree.tables, ...tree.files].map((n) => n.toLowerCase()),
    );
    const created: string[] = [];
    const skipped: string[] = [];
    for (const starter of STARTERS) {
      const name = `${folder}/${starter.name}`;
      if (taken.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      try {
        created.push(await s.vault.create(name, "note", starter.text));
      } catch (e) {
        if (e instanceof Refused) throw err(400, e.message);
        throw e;
      }
    }
    return c.json({ folder, created, skipped });
  });
}
