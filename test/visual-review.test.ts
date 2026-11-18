import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { compare, decode, encode } from "../scripts/lib/png.mjs";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { checkReview, chromeFiles, label, MARKER, pairUp, renderComment, surfaceName } from "../scripts/visual-review.mjs";

/**
 * **The visual review's decisions** (#528): which pull requests it looks at, how it pairs and
 * compares the pictures, what it accepts from the agent and what the comment says. Docker, git and
 * `gh` around them are not tested here; these are the parts whose mistakes are silent — an agent run
 * on a pull request that changes no chrome, a hair of rasterisation read as a change, a finding that
 * names a picture nobody can show.
 */

describe("chromeFiles", () => {
  it("is the chrome's code, the themes, DESIGN.md, the surfaces spec and the chrome's baselines", () => {
    const files = [
      "src/styles/chrome/08-guides-and-groups.css",
      "src/ui/Sidebar.tsx",
      "src/settings/panes/General.tsx",
      "themes/paper/theme.json",
      "DESIGN.md",
      "e2e/surfaces.spec.ts",
      "e2e/surfaces.spec.ts-snapshots/board-paper-linux.png",
      "e2e/settings.spec.ts-snapshots/settings-paper-linux.png",
    ];
    expect(chromeFiles(files)).toEqual(files);
  });

  it("leaves out what cannot change how the chrome looks, and the diagram's own baselines", () => {
    expect(
      chromeFiles([
        "scripts/merge-queue.mjs",
        "server/vault.ts",
        "src/layout/size.ts",
        "docs/architecture/gate-and-releases.md",
        "e2e/reference.spec.ts-snapshots/reference-erd-paper-linux.png",
        "e2e/export.spec.ts-snapshots/architecture-item-linux.png",
        "e2e/notes.spec.ts",
      ]),
    ).toEqual([]);
  });
});

describe("names", () => {
  it("flattens a spec and its picture into one name", () => {
    expect(surfaceName("surfaces.spec.ts", "settings-tags-paper-dark-linux.png")).toBe("surfaces--settings-tags-paper-dark");
    expect(surfaceName("settings.spec.ts", "settings-ai-neutral-linux.png")).toBe("settings--settings-ai-neutral");
  });

  it("says a name the way a person would, with its theme", () => {
    expect(label("surfaces--settings-vault-general-paper")).toBe("Settings vault general · light");
    expect(label("surfaces--board-paper-dark")).toBe("Board · dark");
    expect(label("callouts--callouts-note-neutral")).toBe("Callouts note · neutral");
  });
});

describe("pairUp", () => {
  const diffs: Record<string, { sized: boolean; ratio: number }> = {
    a: { sized: true, ratio: 0 },
    b: { sized: true, ratio: 0.00005 },
    c: { sized: true, ratio: 0.02 },
    d: { sized: false, ratio: 1 },
  };
  it("marks each picture same, changed, new or removed", () => {
    const pairs = pairUp(["a", "b", "c", "d", "gone"], ["a", "b", "c", "d", "fresh"], (n: string) => diffs[n]);
    expect(Object.fromEntries(pairs.map((p: { name: string; status: string }) => [p.name, p.status]))).toEqual({
      a: "same",
      b: "same",
      c: "changed",
      d: "changed",
      fresh: "new",
      gone: "removed",
    });
  });
});

describe("compare", () => {
  const solid = (w: number, h: number, rgb: [number, number, number]) => {
    const data = Buffer.alloc(w * h * 4);
    for (let p = 0; p < w * h; p++) data.set([...rgb, 255], p * 4);
    return { width: w, height: h, data };
  };

  it("reads back what it writes", () => {
    const img = solid(7, 5, [12, 200, 90]);
    img.data.set([1, 2, 3, 255], 4 * 9);
    const back = decode(encode(img));
    expect(back.width).toBe(7);
    expect(back.height).toBe(5);
    expect(Buffer.compare(back.data, img.data)).toBe(0);
  });

  it("does not count a hair of rasterisation, and counts a real move", () => {
    const a = solid(10, 10, [100, 100, 100]);
    const hair = solid(10, 10, [104, 100, 97]);
    expect(compare(a, hair).pixels).toBe(0);
    const moved = solid(10, 10, [100, 100, 100]);
    moved.data.set([0, 0, 0, 255], 0);
    const d = compare(a, moved);
    expect(d.pixels).toBe(1);
    expect(d.ratio).toBeCloseTo(0.01);
    expect(d.image.width).toBe(10);
  });

  it("calls two sizes a change, with no picture of it", () => {
    const d = compare(solid(4, 4, [0, 0, 0]), solid(4, 5, [0, 0, 0]));
    expect(d).toMatchObject({ sized: false, ratio: 1, image: null });
  });
});

const manifest = {
  pr: 534,
  base: "60027b7aaaaaaaa",
  head: "1d9b576bbbbbbbb",
  failed: [],
  surfaces: [
    { name: "surfaces--settings-vault-general-paper", status: "changed" },
    { name: "surfaces--settings-vault-general-paper-dark", status: "changed" },
    { name: "surfaces--settings-export-paper", status: "changed" },
    { name: "surfaces--board-paper", status: "same" },
    { name: "surfaces--settings-tags-paper", status: "new" },
  ],
};

const review = {
  summary: "The gap between Settings groups was cut.",
  findings: [
    {
      severity: "regression",
      surfaces: ["surfaces--settings-vault-general-paper", "surfaces--settings-vault-general-paper-dark"],
      title: "The groups run together.",
      detail: "The gap between Folder and Problems fell from 28 px to 6 px.",
      rule: "DESIGN.md › Space, corners and elevation",
      also: ["surfaces--settings-export-paper"],
    },
    {
      severity: "note",
      surfaces: ["surfaces--settings-tags-paper"],
      title: "Counts are slate.",
      detail: "Fine on paper100.",
      preexisting: true,
    },
  ],
};

describe("checkReview", () => {
  it("takes a review whose findings name pictures the capture has", () => {
    expect(checkReview(review, manifest.surfaces)).toEqual([]);
  });

  it("says what is wrong with one that does not", () => {
    const bad = {
      findings: [{ severity: "bad", surfaces: ["surfaces--nowhere"], title: "", detail: "x" }],
      fine: ["surfaces--also-nowhere"],
    };
    expect(checkReview(bad, manifest.surfaces)).toEqual([
      "`summary` is missing",
      "findings[0].severity must be one of regression, note",
      'findings[0].surfaces: no picture is called "surfaces--nowhere"',
      "findings[0].title is missing",
      'fine: no picture is called "surfaces--also-nowhere"',
    ]);
  });
});

describe("renderComment", () => {
  const url = (side: string, name: string) => `https://x/${side}/${name}.png`;
  const body = renderComment(manifest, review, url);

  it("starts with the marker that finds it again, and the counts", () => {
    expect(body.startsWith(`${MARKER}\n**Visual review** (advisory) · 3 pictures changed, 1 new · merge base \`60027b7\``)).toBe(
      true,
    );
  });

  it("shows each regression with its before and after, and links where the pixels moved", () => {
    expect(body).toContain("**Regressions**");
    expect(body).toContain("1. **The groups run together.** The gap between Folder and Problems fell from 28 px to 6 px.");
    expect(body).toContain(
      "| ![before](https://x/before/surfaces--settings-vault-general-paper.png) | ![after](https://x/after/surfaces--settings-vault-general-paper.png) |",
    );
    expect(body).toContain("[where the pixels moved](https://x/diff/surfaces--settings-vault-general-paper-dark.png)");
  });

  it("puts what was already so under the notes, and names the changes nobody flagged", () => {
    expect(body).toContain(
      "- **Settings tags · light: Counts are slate.** Fine on paper100. Already so before this pull request.",
    );
    expect(body).not.toContain("Changed, looks right");
    expect(body).not.toContain("Board · light");
  });

  it("names a finding's other pictures without showing them, and never as looking right", () => {
    expect(body).toContain("(DESIGN.md › Space, corners and elevation) Also on Settings export · light.");
    expect(body).not.toContain("after/surfaces--settings-export-paper.png");
    const quietReview = { ...review, findings: [review.findings[1]] };
    expect(renderComment(manifest, quietReview, url)).toContain(
      "**Changed, looks right:** Settings vault general · light, Settings vault general · dark, Settings export · light.",
    );
  });

  it("says so in one line when nothing looks different", () => {
    const quiet = renderComment(
      { ...manifest, surfaces: [{ name: "surfaces--board-paper", status: "same" }] },
      { summary: "", findings: [] },
      url,
    );
    expect(quiet).toContain("No surface with a screenshot looks any different");
    expect(quiet).not.toContain("Regressions");
  });
});
