import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { applyPatch } from "@/board/patch";
import { repairFrontmatter, retypeFence } from "@/board/repair";
import { ASPECT_START, FLOW_DEFAULT, aspectAttr, aspectChoice, flowMeta, themeMeta } from "@/board/settings";
import { CODES } from "@/dsl/codes";
import { planRepair, repairable } from "@/edit/repair";
import { Frame } from "@/render/Frame";
import { frameHueVars } from "@/render/hue";
import { THEMES } from "@/theme/useTheme";

/**
 * The settings a board has that only the file's text said: `theme:` and `flow:` in the frontmatter,
 * a fence's `aspect=`, a diagram's own `hue=` — and the repairs for what would not parse far enough
 * to have a control. Each writer is checked against `applyPatch`/`parseBoard`, the two things that
 * decide what the file means, not against a string it was expected to equal.
 */

const apply = (text: string, meta: Record<string, unknown>) => {
  const r = applyPatch(text, [{ meta }]);
  if (!r.ok) throw new Error(r.error);
  return r.text;
};

describe("theme: and flow:", () => {
  const board = "```arch {#a}\nservice api\n```\n";

  it("themeMeta writes the word and null takes it off", () => {
    const set = apply(board, themeMeta("paper-dark").meta);
    expect(set.startsWith("---\ntheme: paper-dark\n---\n")).toBe(true);
    expect(parseBoard("b", set).theme).toBe("paper-dark");

    const off = apply(set, themeMeta(null).meta);
    expect(off).toBe(board);
    expect(parseBoard("b", off).theme).toBeUndefined();
  });

  it("an empty name is no theme, not a theme called nothing", () => {
    expect(themeMeta("  ").meta).toEqual({ theme: null });
  });

  it("flowMeta writes only what differs from the default", () => {
    expect(flowMeta(2000, FLOW_DEFAULT.gap)?.meta).toEqual({ flow: { width: 2000 } });
    expect(flowMeta(FLOW_DEFAULT.width, 40)?.meta).toEqual({ flow: { gap: 40 } });
    expect(flowMeta(2000, 40)?.meta).toEqual({ flow: { width: 2000, gap: 40 } });
  });

  it("flowMeta takes `flow:` off when both are the default", () => {
    const set = apply(board, flowMeta(2000, 40)!.meta);
    expect(parseBoard("b", set).flow).toEqual({ width: 2000, gap: 40 });
    const back = apply(set, flowMeta(FLOW_DEFAULT.width, FLOW_DEFAULT.gap)!.meta);
    expect(back).toBe(board);
    expect(parseBoard("b", back).flow).toEqual(FLOW_DEFAULT);
  });

  it("flowMeta rounds, and refuses what is not a number the flow can use", () => {
    expect(flowMeta(2000.4, 40.6)?.meta).toEqual({ flow: { width: 2000, gap: 41 } });
    expect(flowMeta(Number.NaN, 40)).toBeNull();
    expect(flowMeta(3, 40)).toBeNull();
    expect(flowMeta(2000, -1)).toBeNull();
    expect(flowMeta(10 ** 6, 40)).toBeNull();
  });

  it("keeps the keys it does not know, and the pages", () => {
    const text = "---\ntitle: T\npages:\n  - id: page-1\n    name: One\nextra: kept\n---\n\n```md {#a}\nx\n```\n";
    const out = apply(text, themeMeta("neutral").meta);
    const b = parseBoard("b", out);
    expect(b.theme).toBe("neutral");
    expect(b.title).toBe("T");
    expect(b.pages.map((p) => p.name)).toEqual(["One"]);
    expect(out).toContain("extra: kept");
  });
});

describe("aspect=", () => {
  it("reads what the file says as a choice", () => {
    expect(aspectChoice(undefined)).toBe("auto");
    expect(aspectChoice(0)).toBe("off");
    expect(aspectChoice(1.6)).toBe("ratio");
    expect(aspectChoice(-1)).toBe("invalid");
    expect(aspectChoice("wide")).toBe("invalid");
  });

  it("and writes a choice back: nothing, zero, or a number", () => {
    expect(aspectAttr("auto")).toBeNull();
    expect(aspectAttr("off")).toBe(0);
    expect(aspectAttr("ratio", 2.345)).toBe(2.35);
    expect(aspectAttr("ratio", ASPECT_START)).toBe(1.6);
  });

  it("a half-typed ratio writes nothing, so it can never turn wrapping off by being zero", () => {
    expect(aspectAttr("ratio")).toBeUndefined();
    expect(aspectAttr("ratio", 0)).toBeUndefined();
    expect(aspectAttr("ratio", Number.NaN)).toBeUndefined();
  });

  const fence = (attrs: string) => `\`\`\`arch {#a ${attrs}}\nservice api\n\`\`\`\n`;
  const set = (text: string, aspect: number | null) => {
    const r = applyPatch(text, [{ id: "a", attrs: { aspect } }]);
    if (!r.ok) throw new Error(r.error);
    return r.text;
  };

  it("`aspect=0` is written as a 0 and read back as no wrapping", () => {
    const out = set(fence("title=T"), 0);
    expect(out).toContain("aspect=0");
    const item = parseBoard("b", out).items[0]!;
    expect(item.aspect).toBe(0);
    expect(parseBoard("b", out).errors).toEqual([]);
  });

  it("clearing it removes the attribute and its error, and touches nothing else", () => {
    const bad = fence("aspect=-2 title=T");
    expect(parseBoard("b", bad).errors.map((e) => e.code)).toContain(CODES.EB_BAD_ASPECT);
    const out = set(bad, null);
    expect(out).toBe(fence("title=T"));
    expect(parseBoard("b", out).errors).toEqual([]);
  });
});

describe("a diagram's own hue=", () => {
  const theme = THEMES.paper!;
  const frame = (hue: string | undefined, bare: boolean) =>
    renderToStaticMarkup(
      createElement(Frame, {
        item: { id: "a", type: "arch", body: "", title: "T", hue, page: "page-1", note: false, hidden: false } as never,
        width: 400,
        theme,
        bare,
        children: null,
      }),
    );

  it("binds the frame's own variables from the theme's hue, and the cards' not at all", () => {
    expect(frameHueVars("teal")).toEqual({ "--frame-h": "var(--dag-color-hues-teal)", "--frame-t": "var(--dag-tint-teal)" });
    const html = frame("teal", false);
    expect(html).toContain("--frame-h:var(--dag-color-hues-teal)");
    expect(html).toContain("--frame-t:var(--dag-tint-teal)");
    /* `--dag-h` is what every card inside inherits: binding it here would recolour all of them. */
    expect(html).not.toContain("--dag-h:");
    expect(html).toContain("dag-frame--hued");
    expect(html).toContain("dag-frame__head--hued");
  });

  it("tints the band by stretching the header, so the box does not change", () => {
    const m = theme.metric.frame;
    const plain = frame(undefined, false);
    const hued = frame("teal", false);
    expect(plain).toContain(`height:${m.headerH - m.pad}px`);
    expect(hued).toContain(`height:${m.headerH}px`);
    expect(hued).toContain(`margin-top:-${m.pad}px`);
    expect(hued).toContain(`padding-top:${m.pad}px`);
    /* Out by the padding the section gave it and that padding put back in: the same bottom edge. */
    expect(m.headerH - m.pad + m.pad).toBe(m.headerH);
  });

  it("an unhued frame is exactly what it was", () => {
    const html = frame(undefined, false);
    expect(html).not.toContain("hued");
    expect(html).not.toContain("--frame-");
  });

  it("a bare frame keeps the border and has no band to tint", () => {
    const html = frame("teal", true);
    expect(html).toContain("dag-frame--bare dag-frame--hued");
    expect(html).not.toContain("dag-frame__head");
  });

  it("every theme has every hue the swatches offer", () => {
    for (const t of Object.values(THEMES)) {
      for (const hue of Object.keys(THEMES.paper!.color.hues)) expect(t.color.hues[hue], `${t.name}: ${hue}`).toBeDefined();
    }
  });

  it("round-trips through the fence line like any attribute", () => {
    const text = "```arch {#a title=T}\nservice api\n```\n";
    const r = applyPatch(text, [{ id: "a", attrs: { hue: "teal" } }]);
    expect(r.ok && r.text).toBe("```arch {#a title=T hue=teal}\nservice api\n```\n");
    const off = applyPatch((r as { text: string }).text, [{ id: "a", attrs: { hue: null } }]);
    expect(off.ok && off.text).toBe(text);
    expect(parseBoard("b", (r as { text: string }).text).items[0]!.hue).toBe("teal");
  });
});

describe("repairFrontmatter", () => {
  const body = "```arch {#a}\nservice api\n```\n";

  it("keeps every setting that reads and drops the one that does not, byte for byte", () => {
    const text = `---\ntitle: Kept\ntheme: [unclosed\nflow:\n  width: 2000\n---\n\n${body}`;
    expect(parseBoard("b", text).errors.map((e) => e.code)).toContain(CODES.EB_FRONTMATTER);
    const r = repairFrontmatter(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.dropped).toEqual(["theme"]);
    expect(r.text).toBe(`---\ntitle: Kept\nflow:\n  width: 2000\n---\n\n${body}`);
    const b = parseBoard("b", r.text);
    expect(b.errors).toEqual([]);
    expect(b.title).toBe("Kept");
    expect(b.flow.width).toBe(2000);
  });

  it("a list under a key stays with its key", () => {
    const text = `---\npages:\n  - id: page-1\n    name: One\nbad: [x\n---\n\n${body}`;
    const r = repairFrontmatter(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.dropped).toEqual(["bad"]);
    expect(parseBoard("b", r.text).pages.map((p) => p.name)).toEqual(["One"]);
  });

  it("removes the whole block when nothing in it can be read", () => {
    const text = `---\n: : :\n  - [\n---\n\n${body}`;
    const r = repairFrontmatter(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toBe(body);
    expect(r.dropped.length).toBeGreaterThan(0);
    expect(parseBoard("b", r.text).errors).toEqual([]);
  });

  it("removes the whole block when what is left still does not read as one", () => {
    const text = `---\ntitle: A\ntitle: B\nx: [y\n---\n\n${body}`;
    const r = repairFrontmatter(text);
    if (!r.ok) throw new Error(r.error);
    expect(parseBoard("b", r.text).errors).toEqual([]);
  });

  it("refuses a board that has nothing to repair", () => {
    expect(repairFrontmatter(body).ok).toBe(false);
    expect(repairFrontmatter(`---\ntitle: fine\n---\n\n${body}`).ok).toBe(false);
  });
});

describe("retypeFence", () => {
  const text = "---\ntitle: T\n---\n\n```md {#intro}\nhello\n```\n\n```flwo {#f x=0}\na --> b\n```\n";

  it("changes the word after the backticks and nothing else", () => {
    const line = parseBoard("b", text).errors.find((e) => e.code === CODES.EB_UNKNOWN_TYPE)!.line;
    const r = retypeFence(text, line, "flwo", "flow");
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toBe(text.replace("```flwo", "```flow"));
    const b = parseBoard("b", r.text);
    expect(b.errors).toEqual([]);
    expect(b.items.map((i) => i.type)).toEqual(["md", "flow"]);
  });

  it("is refused when the line no longer says what it was offered for", () => {
    expect(retypeFence(text, 5, "flwo", "flow").ok).toBe(false);
    expect(retypeFence(text, 9, "other", "flow").ok).toBe(false);
  });

  it("will not relabel as a word that is not a kind", () => {
    expect(retypeFence(text, 9, "flwo", "nonsense").ok).toBe(false);
  });
});

describe("planRepair", () => {
  const item = (text: string) => parseBoard("b", text);

  it("says only what it can do something about", () => {
    expect(repairable(CODES.EB_FRONTMATTER)).toBe(true);
    expect(repairable(CODES.EB_UNKNOWN_TYPE)).toBe(true);
    expect(repairable(CODES.EB_BAD_LAYOUT)).toBe(true);
    expect(repairable(CODES.EB_BAD_DIR)).toBe(false);
  });

  it("offers the broken settings block a repair, in words", () => {
    const text = "---\ntitle: [x\n---\n\n```md {#a}\nx\n```\n";
    const b = item(text);
    const p = b.errors.find((e) => e.code === CODES.EB_FRONTMATTER)!;
    const r = planRepair(text, b, p)!;
    expect(r.fix).toEqual({ kind: "frontmatter" });
    expect(r.words).toMatch(/cannot be read/);
  });

  it("leads an unknown fence's choices with the nearest kind", () => {
    const text = "```flo {#f}\na --> b\n```\n";
    const b = item(text);
    const p = b.errors.find((e) => e.code === CODES.EB_UNKNOWN_TYPE)!;
    const r = planRepair(text, b, p)!;
    expect(r.fix).toMatchObject({ kind: "retype", from: "flo", to: "flow", line: 1 });
    expect(r.choices![0]).toEqual({ value: "flow", suggested: true });
    expect(r.choices!.filter((c) => c.suggested)).toHaveLength(1);
    expect(r.words).toContain("`flo`");
  });

  it("leads with nothing when the word is near nothing", () => {
    const text = "```zzzzzzzz {#f}\nx\n```\n";
    const b = item(text);
    const r = planRepair(text, b, b.errors.find((e) => e.code === CODES.EB_UNKNOWN_TYPE)!)!;
    expect(r.choices!.some((c) => c.suggested)).toBe(false);
    expect(r.words).not.toContain("Did you mean");
  });

  it("takes a bad layout or aspect off the fence line, through an ordinary patch", () => {
    const text = "```arch {#a layout=grid aspect=-1}\nservice api\n```\n";
    const b = item(text);
    for (const code of [CODES.EB_BAD_LAYOUT, CODES.EB_BAD_ASPECT]) {
      const p = b.errors.find((e) => e.code === code)!;
      const r = planRepair(text, b, p)!;
      expect(r.fix.kind).toBe("attr");
      const fix = r.fix as { item: string; key: string };
      expect(fix.item).toBe("a");
      const done = applyPatch(text, [{ id: fix.item, attrs: { [fix.key]: null } }]);
      expect(done.ok).toBe(true);
    }
    const both = applyPatch(text, [{ id: "a", attrs: { layout: null, aspect: null } }]);
    expect(both.ok && parseBoard("b", both.text).errors).toEqual([]);
  });

  it("offers nothing for a code it has no words for", () => {
    const text = "```arch {#a dir=sideways}\nservice api\n```\n";
    const b = item(text);
    expect(planRepair(text, b, b.errors.find((e) => e.code === CODES.EB_BAD_DIR)!)).toBeNull();
  });
});
