/**
 * A body edit that meets a 409 is rebased onto the text the 409 carried, not re-sent (#393).
 *
 * The race: a person edits a card inside a diagram fence while an agent adds `queue jobs "Jobs"` to
 * the same fence. The page's patch is refused with the agent's text; the retry used to post the same
 * `{id, body}`, rendered from the old text, and the agent's line was gone with nobody told. Each case
 * below builds the op the gesture builds — with the same `src/dsl/restate.ts` writer — against the
 * text the person was looking at, then checks what the retry writes over the agent's text, and that
 * re-sending the op as it was (the defect) would have lost the line.
 */
import { describe, expect, it } from "vitest";

import { applyPatch, type PatchOp } from "@/board/patch";
import { mergeBody, rebaseOps } from "@/board/rebase";
import { moveStatement, removeNode, renameId, replaceLine, setTitle } from "@/dsl/restate";

const board = (body: string) => `---\ntitle: Body race\n---\n\n\`\`\`arch {#infra x=0 y=0}\n${body}\n\`\`\`\n`;
const bodyOf = (text: string) => /```arch \{#infra x=0 y=0\}\n([\s\S]*?)\n```/.exec(text)![1]!;

const BODY = 'service api "API"\nstore db "Database"\n\napi --> db';
/** The agent's write: a new card under the last one, in the same fence. */
const THEIRS = 'service api "API"\nstore db "Database"\nqueue jobs "Jobs"\n\napi --> db';

/** What the retry writes: the op rebased from the person's text onto the agent's, then applied. */
function retried(ops: PatchOp[], from = board(BODY), onto = board(THEIRS)): string {
  const rebased = rebaseOps(ops, from, onto);
  if (!rebased.ok) throw new Error(`refused: ${rebased.ids.join(", ")}`);
  const done = applyPatch(onto, rebased.ops);
  if (!done.ok) throw new Error(done.error);
  return done.text;
}

/** What the defect wrote: the same op, as it was rendered, over the agent's text. */
function resent(ops: PatchOp[], onto = board(THEIRS)): string {
  const done = applyPatch(onto, ops);
  if (!done.ok) throw new Error(done.error);
  return done.text;
}

const lineOf = (body: string, n: number) => body.split("\n")[n - 1]!;

describe("a body edit racing an external line in the same fence", () => {
  it("keeps the agent's line under a Properties-panel title change", () => {
    const ops: PatchOp[] = [{ id: "infra", body: replaceLine(BODY, 1, setTitle(lineOf(BODY, 1), "API v2", "arch")) }];
    expect(resent(ops)).not.toContain('queue jobs "Jobs"');

    expect(bodyOf(retried(ops))).toBe('service api "API v2"\nstore db "Database"\nqueue jobs "Jobs"\n\napi --> db');
  });

  it("keeps it under an inline retitle of the card right above it", () => {
    /* The change and the agent's insertion touch: `merge3` would call this a conflict. */
    const ops: PatchOp[] = [{ id: "infra", body: replaceLine(BODY, 2, setTitle(lineOf(BODY, 2), "Postgres", "arch")) }];
    expect(resent(ops)).not.toContain('queue jobs "Jobs"');

    expect(bodyOf(retried(ops))).toBe('service api "API"\nstore db "Postgres"\nqueue jobs "Jobs"\n\napi --> db');
  });

  it("keeps it under an id rename, which rewrites every edge that names the card", () => {
    const ops: PatchOp[] = [{ id: "infra", body: renameId(BODY, "api", "gateway") }];
    expect(resent(ops)).not.toContain('queue jobs "Jobs"');

    expect(bodyOf(retried(ops))).toBe('service gateway "API"\nstore db "Database"\nqueue jobs "Jobs"\n\ngateway --> db');
  });

  it("keeps it under Delete on the picked card the line was written after", () => {
    const ops: PatchOp[] = [{ id: "infra", body: removeNode(BODY, "db", { type: "arch" }) }];
    expect(resent(ops)).not.toContain('queue jobs "Jobs"');

    const body = bodyOf(retried(ops));
    expect(body).toContain('queue jobs "Jobs"');
    expect(body).toContain('service api "API"');
    expect(body).not.toContain("db");
  });

  it("keeps it under a card dropped into a group", () => {
    const grouped = 'group core "Core" {\n  service api "API"\n}\nstore db "Database"\n\napi --> db';
    const theirs = 'group core "Core" {\n  service api "API"\n}\nstore db "Database"\nqueue jobs "Jobs"\n\napi --> db';
    const ops: PatchOp[] = [{ id: "infra", body: moveStatement(grouped, 4, { intoBlockLine: 1 }) }];
    expect(resent(ops, board(theirs))).not.toContain('queue jobs "Jobs"');

    const body = bodyOf(retried(ops, board(grouped), board(theirs)));
    expect(body).toContain('queue jobs "Jobs"');
    expect(body).toMatch(/group core "Core" \{\n(.*\n)*\s+store db "Database"\n(.*\n)*\}/);
    expect(body.indexOf('store db "Database"')).toBeLessThan(body.indexOf("}"));
  });
});

describe("rebaseOps", () => {
  it("sends the op it was given when the other writer changed nothing inside the item", () => {
    const ops: PatchOp[] = [{ id: "infra", body: renameId(BODY, "api", "gateway") }];
    const onto = `${board(BODY)}\n\`\`\`md {#note}\nSomebody else's note.\n\`\`\`\n`;
    const rebased = rebaseOps(ops, board(BODY), onto);
    expect(rebased).toEqual({ ok: true, ops });
  });

  it("leaves an attrs op, a remove and an insert as they were", () => {
    const ops: PatchOp[] = [
      { id: "infra", attrs: { x: 40 } },
      { id: "infra", remove: true },
      { insert: { type: "md", attrs: { id: "fresh" }, body: "New." } },
    ];
    expect(rebaseOps(ops, board(BODY), board(THEIRS))).toEqual({ ok: true, ops });
  });

  it("refuses an edit to the lines the other writer changed differently", () => {
    const ops: PatchOp[] = [{ id: "infra", body: replaceLine(BODY, 1, setTitle(lineOf(BODY, 1), "Mine", "arch")) }];
    const onto = board(replaceLine(BODY, 1, setTitle(lineOf(BODY, 1), "Theirs", "arch")));
    expect(rebaseOps(ops, board(BODY), onto)).toEqual({ ok: false, ids: ["infra"] });
  });

  it("refuses an edit to an item the other writer removed, rather than writing it back", () => {
    const ops: PatchOp[] = [{ id: "infra", body: renameId(BODY, "api", "gateway") }];
    expect(rebaseOps(ops, board(BODY), "---\ntitle: Body race\n---\n")).toEqual({ ok: false, ids: ["infra"] });
  });
});

describe("mergeBody", () => {
  it("takes either side when only one moved, and one copy of an edit both made", () => {
    expect(mergeBody("a\nb", "a\nB", "a\nb")).toBe("a\nB");
    expect(mergeBody("a\nb", "a\nb", "a\nb\nc")).toBe("a\nb\nc");
    expect(mergeBody("a\nb\nc", "a\nB\nc\nd", "a\nB\nc")).toBe("a\nB\nc\nd");
  });

  it("merges edits to lines that only touch, an insertion going before the range it starts", () => {
    expect(mergeBody("a\nb\nc", "a\nB\nc", "a\nb\nC")).toBe("a\nB\nC");
    expect(mergeBody("a\nb", "a\nB", "a\nx\nb")).toBe("a\nx\nB");
  });

  it("is a conflict when the two overlap, or insert different lines at one place", () => {
    expect(mergeBody("a\nb\nc", "a\nB\nc", "a\nb2\nc")).toBeNull();
    expect(mergeBody("a\nb\nc", "a\nc", "a\nx\nc")).toBeNull();
    expect(mergeBody("a\nb", "a\nx\nb", "a\ny\nb")).toBeNull();
    /* An insertion strictly inside a range the other side replaced. */
    expect(mergeBody("a\nb\nc\nd", "a\nB\nd", "a\nb\nx\nc\nd")).toBeNull();
  });

  it("deletes line by line, so a line put between two deleted ones stays, and one deleted twice goes once", () => {
    expect(mergeBody("a\nb\nc\nd", "a\nd", "a\nb\nx\nc\nd")).toBe("a\nx\nd");
    expect(mergeBody("a\nb\nc\nd", "a\nd", "a\nb\nd")).toBe("a\nd");
  });
});
