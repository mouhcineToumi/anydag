import { describe, expect, it } from "vitest";

import { remoteImage, verbOf } from "../src/assistant/words";

describe("verbOf", () => {
  it("reads a chat's doc_* call as the tool its kind names", () => {
    expect(verbOf("mcp__anydag__doc_create", { kind: "note", name: "plan" })).toBe(verbOf("note_create"));
    expect(verbOf("anydag_doc_list", { kind: "board" })).toBe("Listed boards");
    expect(verbOf("doc_read", { kind: "quiz" })).toBe("Read a quiz");
  });

  it("leaves a doc_* call with no kind it knows as its own words", () => {
    expect(verbOf("doc_read")).toBe("Doc read");
    expect(verbOf("doc_read", { kind: "spaceship" })).toBe("Doc read");
  });
});

describe("remoteImage", () => {
  const PAGE = "http://127.0.0.1:3500/?chat=c1";
  /* An image in a reply loads as soon as it is drawn, so one that reaches another host would carry
     whatever the agent put in its URL out of the chat with no click (#10). */
  it("is any image that would be fetched from somewhere other than this app", () => {
    for (const src of [
      "https://example.com/p.gif?d=secret",
      "http://127.0.0.1:3501/p.gif",
      "http://127.0.0.1:9999/p.gif",
      "HTTPS://example.com/x.png",
      "//example.com/p.gif",
      " https://example.com/p.gif",
      "ftp://example.com/p.gif",
      "/\\example.com/p.gif",
      "\\\\example.com/p.gif",
      "/\t/example.com/p.gif",
      "http://127.0.0.1:3500.example.com/p.gif",
    ])
      expect(remoteImage(src, PAGE), JSON.stringify(src)).toBe(true);
  });

  it("is not a reference, nor a path on this app's own origin", () => {
    for (const src of [
      undefined,
      "",
      "dag:a1b2c3d4e5",
      "wiki:Plan",
      "/__board/file?name=a.png",
      "attachments/a.png",
      "http://127.0.0.1:3500/__board/file?name=a.png",
      "data:image/png;base64,AAAA",
    ])
      expect(remoteImage(src, PAGE), String(src)).toBe(false);
  });
});
