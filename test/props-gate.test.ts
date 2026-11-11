import { describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { parseGitgraph } from "@/dsl/graph/gitgraph";
import { labelOf, parseTimeline } from "@/dsl/graph/timeline";
import { HUE_ORDER, type Diagnostic } from "@/dsl/ir";
import { replaceLine, setFlag, setMeta, setModifier, setStatus, setTitle } from "@/dsl/restate";
import { parseSequence } from "@/dsl/sequence";
import { pickControls } from "@/edit/Props";

/**
 * What the properties panel offers a picked statement, held to the parser that reads it.
 *
 * `pickControls` is the gate `PickProps` renders from. For the three dialects that do not use the
 * shared `modifiers()` grammar, this checks both halves of the claim: a word the gate offers is
 * read by the parser, and a word it refuses is one the parser rejects or reads past. The parser is
 * the authority — a comment naming a line is not.
 */

const write = (body: string, line: number, next: string) => replaceLine(body, line, next);
const errors = (diagnostics: readonly Diagnostic[]) => diagnostics.filter((d) => d.severity === "error");

describe("a sequence participant", () => {
  const BODY = 'participant api "API"';
  const controls = pickControls("sequence", "node");

  it("offers hue, icon and meta — the modifiers parseSequence reads", () => {
    expect(controls).toEqual({ hue: true, status: "none", flags: false, icon: true, meta: true, em: false });

    const hue = write(BODY, 1, setModifier(BODY, "hue", "teal"));
    expect(parseSequence(hue).participants[0]?.hue).toBe("teal");
    const icon = write(BODY, 1, setModifier(BODY, "icon", "server"));
    expect(parseSequence(icon).participants[0]?.icon).toBe("server");
    const meta = write(BODY, 1, setMeta(BODY, "fastapi"));
    expect(parseSequence(meta).participants[0]?.meta).toBe("fastapi");
  });

  it("offers no status or flag: a bare word after the strings is read as the next statement", () => {
    expect(controls.status).toBe("none");
    expect(controls.flags).toBe(false);

    const done = write(BODY, 1, setStatus(BODY, "done"));
    expect(done).toBe('participant api "API" done');
    expect(errors(parseSequence(done).diagnostics).map((d) => d.code)).toContain(CODES.E_EXPECTED_ARROW);

    const async = write(BODY, 1, setFlag(BODY, "async", true));
    expect(errors(parseSequence(async).diagnostics).map((d) => d.code)).toContain(CODES.E_EXPECTED_ARROW);
  });
});

describe("a timeline entry", () => {
  const BODY = '2026 "Build"';
  const controls = pickControls("timeline", "node");
  const entry = (body: string) => parseTimeline(body).nodes[0]!;

  it("offers none, done and wait — the only status words parseTimeline reads", () => {
    expect(controls).toEqual({ hue: false, status: "done-wait", flags: false, icon: false, meta: false, em: false });

    expect(entry(write(BODY, 1, setStatus(BODY, "done"))).status).toBe("done");
    expect(entry(write(BODY, 1, setStatus(BODY, "wait"))).status).toBe("wait");
    /* `stop` and `muted` are other dialects' words: written here they are accepted and ignored. */
    expect(entry(write(BODY, 1, setStatus(BODY, "stop"))).status).toBeUndefined();
    expect(entry(write(BODY, 1, setStatus(BODY, "muted"))).status).toBeUndefined();
  });

  it("offers no hue, icon, flag, emphasis or second string: the tail is read for done/wait only", () => {
    expect(controls.hue).toBe(false);
    expect(controls.icon).toBe(false);
    expect(controls.flags).toBe(false);
    expect(controls.meta).toBe(false);
    expect(controls.em).toBe(false);

    expect(entry(write(BODY, 1, setModifier(BODY, "hue", "coral"))).hue).toBeUndefined();
    expect(entry(write(BODY, 1, setModifier(BODY, "icon", "server"))).icon).toBeUndefined();
    expect(entry(write(BODY, 1, setFlag(BODY, "async", true))).async).toBeUndefined();
    expect(entry(write(BODY, 1, setFlag(BODY, "bold", true))).bold).toBeUndefined();
    /* The second string lands in the ignored tail; the entry's `meta` stays its date. */
    expect(entry(write(BODY, 1, setMeta(BODY, "not a meta"))).meta).toBe("2026");
  });

  it("keeps hue on a section, the one timeline line parseTimeline reads it on", () => {
    expect(pickControls("timeline", "group").hue).toBe(true);
    expect(parseTimeline('section "2026" hue=coral\n  2026 "Build"').groups[0]?.hue).toBe("coral");
  });

  it("reads and writes the title of a ranged entry, whose `..` the tokenizer reads as an arrow", () => {
    const RANGE = '2026-03 .. 2026-06 "Build" done';
    expect(labelOf(RANGE)).toBe("Build");
    const next = setTitle(RANGE, "Ship", "timeline");
    expect(next).toBe('2026-03 .. 2026-06 "Ship" done');
    expect(entry(next)).toMatchObject({ title: "Ship", meta: "2026-03 → 2026-06", status: "done" });
  });

  it("never writes a title the parser rejects: cleared is an empty label, a quote is not an escape", () => {
    for (const line of [BODY, '2026-03 .. 2026-06 "Build"', '  2026-09 "Build" wait']) {
      const cleared = setTitle(line, null, "timeline");
      expect(errors(parseTimeline(cleared).diagnostics)).toEqual([]);
      expect(entry(cleared).title).toBe("");
      const quoted = setTitle(line, 'the "big" one', "timeline");
      expect(errors(parseTimeline(quoted).diagnostics)).toEqual([]);
      expect(entry(quoted).title).toBe("the 'big' one");
    }
    const section = setTitle('section "2026" hue=coral', null, "timeline");
    expect(parseTimeline(section).groups[0]).toMatchObject({ label: "", hue: "coral" });
  });
});

describe("a gitgraph commit", () => {
  const BODY = 'commit "init"';
  const controls = pickControls("gitgraph", "node");
  const commit = (body: string) => parseGitgraph(body).nodes[0]!;

  it("offers none of the statement words: a commit is a command with one quoted message", () => {
    expect(controls).toEqual({ hue: false, status: "none", flags: false, icon: false, meta: false, em: false });
  });

  it("reads every modifier past the message and draws none of them", () => {
    /* A commit's hue is its branch's, never the word written on the line. */
    expect(commit(write(BODY, 1, setModifier(BODY, "hue", "coral"))).hue).toBe(HUE_ORDER[0]);
    expect(commit(write(BODY, 1, setStatus(BODY, "done"))).status).toBeUndefined();
    expect(commit(write(BODY, 1, setFlag(BODY, "async", true))).async).toBeUndefined();
    expect(commit(write(BODY, 1, setFlag(BODY, "bold", true))).bold).toBeUndefined();
    expect(commit(write(BODY, 1, setModifier(BODY, "icon", "server"))).icon).toBeUndefined();
    expect(commit(write(BODY, 1, setMeta(BODY, "not a tag"))).meta).toBeUndefined();
  });

  it("reads the first quoted string as the message, which is the one text control GitProps offers", () => {
    expect(commit(write(BODY, 1, setTitle(BODY, "first"))).title).toBe("first");
  });
});

describe("the gate still offers what the shared parser reads", () => {
  it("a graph node keeps every word modifiers() reads", () => {
    expect(pickControls("arch", "node")).toEqual({
      hue: true,
      status: "all",
      flags: true,
      icon: true,
      meta: true,
      em: true,
    });
  });

  it("a group reads its hue and sublabel but no status or flags", () => {
    expect(pickControls("arch", "group")).toEqual({
      hue: true,
      status: "none",
      flags: false,
      icon: false,
      meta: true,
      em: false,
    });
  });

  it("a lane reads its hue and one string, never a second", () => {
    expect(pickControls("flow", "lane")).toMatchObject({ hue: true, meta: false, status: "none" });
  });
});
