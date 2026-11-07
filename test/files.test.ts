import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { fileCard, render } from "../src/board/library";
import { bundle, freePath, namedAssets, namedIds, rewriteIds, zipBundle } from "../src/export/bundle";
import { downloadName, extOf, fileWhat, isPicture, previewOf, sizeWords, sortOf } from "../src/files/types";
import { refusal } from "../src/files/upload";

/** Attachments: what the page reads off a file's name, and what an export carries. */
describe("what a file is, by its name", () => {
  it("reads the extension, lower case, and nothing from a folder's dot", () => {
    expect(extOf("specs/q3-report.pdf")).toBe("pdf");
    expect(extOf("Q3 Report.PDF")).toBe("pdf");
    expect(extOf("a.b/Makefile")).toBe("");
    expect(extOf(".hidden")).toBe("");
  });

  it("tells the ten sorts apart", () => {
    expect(
      ["q.pdf", "a.png", "b.docx", "c.xlsx", "d.csv", "e.pptx", "f.mp3", "g.mov", "h.zip", "i.md", "j.bin"].map(sortOf),
    ).toEqual(["pdf", "image", "doc", "sheet", "sheet", "slide", "audio", "video", "archive", "text", "other"]);
    expect(sortOf("pdf")).toBe("pdf");
  });

  it("previews what a browser draws, and only that", () => {
    expect(previewOf("a.pdf")).toBe("pdf");
    expect(previewOf("a.webp")).toBe("image");
    expect(previewOf("a.heic")).toBeNull();
    expect(previewOf("a.mp4")).toBe("video");
    expect(previewOf("a.csv")).toBe("text");
    expect(previewOf("a.docx")).toBeNull();
    expect(isPicture("a/b.svg")).toBe(true);
    expect(isPicture("a/b.pdf")).toBe(false);
  });

  it("says a size as a person reads it", () => {
    expect(sizeWords(812)).toBe("812 B");
    expect(sizeWords(14 * 1024)).toBe("14 KB");
    expect(sizeWords(2.34 * 1024 * 1024)).toBe("2.3 MB");
    expect(sizeWords(null)).toBe("");
    expect(fileWhat("q3.pdf", 2.34 * 1024 * 1024)).toBe("PDF · 2.3 MB");
    expect(fileWhat("q3.xyz")).toBe("File");
  });

  it("saves under its title, with the extension the title may have left off", () => {
    expect(downloadName("specs/q3.pdf", "Q3 Report")).toBe("Q3 Report.pdf");
    expect(downloadName("specs/q3.pdf", "Q3 Report.PDF")).toBe("Q3 Report.PDF");
    expect(downloadName("specs/q3.pdf")).toBe("q3.pdf");
  });
});

describe("what this server refuses, before anything is sent", () => {
  const limits = { maxBytes: 1024 * 1024, types: ["pdf", "png"] };
  it("says it in the server's own words", () => {
    expect(refusal({ name: "a.pdf", size: 10 }, limits)).toBeNull();
    expect(refusal({ name: "Makefile", size: 10 }, limits)).toBe(
      "`Makefile` has no extension, so there is no telling what it is",
    );
    expect(refusal({ name: "page.html", size: 10 }, limits)).toBe("`.html` files cannot be uploaded here");
    expect(refusal({ name: "big.pdf", size: 3 * 1024 * 1024 }, limits)).toBe("`big.pdf` is 3 MB; the limit is 1 MB");
  });
  it("leaves the rest to the server when it has not said what it takes", () => {
    expect(refusal({ name: "anything.xyz", size: 10 ** 9 }, null)).toBeNull();
  });
});

describe("a file placed on a board", () => {
  it("is a picture drawn from it by id, or the placed card anything else is", () => {
    const pic = fileCard({ id: "k3f9x2m1qa", name: "shots/chart.png", title: "Chart" }, 480);
    expect(pic.type).toBe("image");
    expect(pic.attrs).toEqual({ src: "dag:k3f9x2m1qa", w: 480 });
    const pdf = fileCard({ id: "k3f9x2m1qb", name: "q3.pdf", title: "Q3 [draft].pdf" });
    expect(pdf.type).toBe("md");
    expect(render(pdf)).toBe("![Q3 draft.pdf](dag:k3f9x2m1qb)");
  });
});

describe("an export with the files beside the Markdown", () => {
  const text = [
    "# Plan",
    "",
    "![Q3 Report.pdf](dag:k3f9x2m1qa)",
    "See [the board](dag:0123456789) and [the report](dag:k3f9x2m1qa#page).",
    "",
    "![](plan.assets/paste-1.png)",
    '```image {#pic src="dag:k3f9x2m1qc"}',
    "```",
    "```image {#shot src=plan.assets/paste-2.png}",
    "```",
  ].join("\n");

  it("finds every id and every pasted picture a text names, once each", () => {
    expect(namedIds(text)).toEqual(["k3f9x2m1qa", "0123456789", "k3f9x2m1qc"]);
    expect(namedAssets(text)).toEqual(["plan.assets/paste-1.png", "plan.assets/paste-2.png"]);
    expect(namedAssets("![](https://x.test/a.assets/b.png) ![](../up.assets/c.png)")).toEqual([]);
  });

  it("rewrites only the ids it has a path for", () => {
    expect(rewriteIds("[a](dag:k3f9x2m1qa#p) [b](dag:0123456789)", new Map([["k3f9x2m1qa", "q3.pdf"]]))).toBe(
      "[a](q3.pdf) [b](dag:0123456789)",
    );
  });

  it("numbers two files of one name", () => {
    const taken = new Set(["plan.note.md", "q3.pdf"]);
    expect(freePath(taken, "q3.pdf")).toBe("q3-2.pdf");
    expect(freePath(taken, "q3.pdf")).toBe("q3-3.pdf");
  });

  it("zips the Markdown with its attachments and pictures, and leaves a board a reference", async () => {
    const files: Record<string, { name: string; data: Uint8Array }> = {
      k3f9x2m1qa: { name: "specs/q3-report.pdf", data: new Uint8Array([37, 80, 68, 70]) },
      k3f9x2m1qc: { name: "shots/q3-report.pdf", data: new Uint8Array([1, 2, 3]) },
    };
    const made = await bundle(
      "plan.note.md",
      text,
      async (id) => files[id] ?? null,
      async (path) => (path.endsWith("paste-1.png") ? new Uint8Array([9]) : null),
    );
    expect(made.files.map((f) => f.path)).toEqual(["plan.assets/paste-1.png", "q3-report.pdf", "q3-report-2.pdf"]);
    expect(made.text).toContain("![Q3 Report.pdf](q3-report.pdf)");
    expect(made.text).toContain("[the report](q3-report.pdf)");
    expect(made.text).toContain("[the board](dag:0123456789)");
    expect(made.text).toContain('src="q3-report-2.pdf"');
    const zip = unzipSync(zipBundle("plan.note.md", made));
    expect(Object.keys(zip)).toEqual(["plan.note.md", "plan.assets/paste-1.png", "q3-report.pdf", "q3-report-2.pdf"]);
    expect(new TextDecoder().decode(zip["plan.note.md"])).toBe(made.text);
    expect([...zip["q3-report.pdf"]!]).toEqual([37, 80, 68, 70]);
  });

  it("is nothing but the text when the text names nothing", async () => {
    const made = await bundle(
      "plan.note.md",
      "# Plan\n",
      async () => null,
      async () => null,
    );
    expect(made).toEqual({ text: "# Plan\n", files: [] });
  });
});
