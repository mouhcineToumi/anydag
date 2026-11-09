import fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { attachmentUrl, GitHub, GitHubError } from "../server/github";
import { issueBody, issueTitle } from "../server/routes/feedback";
import { harness, type Harness } from "./helpers";

/**
 * `POST /v1/feedback`: open, capped, rate-limited, every upload before the issue, and nothing kept.
 * GitHub is a fake that answers with the shapes GitHub answers with: `GET /repos/{repo}` and
 * `POST /repos/{repo}/issues` as documented (an `id`, an `html_url`). The user-attachments endpoint
 * is not documented; its answer here carries the address under `href`, and `attachmentUrl` looks
 * for one wherever it is, so a different key does not break a send.
 */

const TOKEN = "github_pat_for_the_tests";
const REPO_ID = 1043219876;
const ISSUE = "https://github.com/mouhcineToumi/anydag/issues/4242";

interface Seen {
  method: string;
  url: string;
  auth: string | null;
  body: string | null;
}

/** A GitHub that records what it was asked, and fails where it is told to. */
function fakeGitHub(fail: { upload?: number; uploadAt?: number; issue?: number } = {}) {
  const seen: Seen[] = [];
  let uploads = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === "string" ? init.body : init?.body ? `<${(init.body as Uint8Array).byteLength} bytes>` : null;
    seen.push({ method, url, auth: headers.get("authorization"), body });
    if (method === "GET" && url === "https://api.github.com/repos/mouhcineToumi/anydag")
      return Response.json({ id: REPO_ID, full_name: "mouhcineToumi/anydag" });
    if (method === "POST" && url.startsWith("https://uploads.github.com/user-attachments/assets?")) {
      uploads++;
      if (fail.upload && (fail.uploadAt ?? 1) === uploads) return Response.json({ message: "nope" }, { status: fail.upload });
      const name = new URL(url).searchParams.get("name");
      return Response.json(
        {
          id: 9000 + uploads,
          name,
          href: `https://github.com/user-attachments/assets/0000000${uploads}-aaaa-bbbb-cccc-dddddddddddd`,
        },
        { status: 201 },
      );
    }
    if (method === "POST" && url === "https://api.github.com/repos/mouhcineToumi/anydag/issues") {
      if (fail.issue) return Response.json({ message: "nope" }, { status: fail.issue });
      return Response.json({ number: 4242, html_url: ISSUE }, { status: 201 });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, seen };
}

function form(parts: {
  kind?: string;
  text?: string;
  boards?: unknown;
  notes?: unknown;
  env?: unknown;
  files?: { name: string; type: string; bytes: Uint8Array }[];
}): FormData {
  const f = new FormData();
  if (parts.kind !== undefined) f.set("kind", parts.kind);
  if (parts.text !== undefined) f.set("text", parts.text);
  if (parts.boards !== undefined) f.set("boards", JSON.stringify(parts.boards));
  if (parts.notes !== undefined) f.set("notes", JSON.stringify(parts.notes));
  f.set("env", JSON.stringify(parts.env ?? { version: "0.3.0", os: "linux", arch: "x64" }));
  for (const file of parts.files ?? [])
    f.append("files", new File([file.bytes as unknown as BlobPart], file.name, { type: file.type }));
  return f;
}

const send = (h: Harness, body: FormData | string, headers: Record<string, string> = {}) =>
  Promise.resolve(h.app.request("/v1/feedback", { method: "POST", body, headers }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const MP4 = new Uint8Array(64).fill(7);

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe("/v1/feedback", () => {
  it("uploads every file, then makes one labelled issue, and keeps nothing", async () => {
    const gh = fakeGitHub();
    h = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN }, { fetch: gh.fetch });
    const before = fs.readdirSync(h.root).sort();
    const res = await send(
      h,
      form({
        kind: "bug",
        text: "The arrows vanish after a tidy.\nSteps below.",
        boards: [{ name: "plan.board.md", text: "```flow\nA --> B\n```\n" }],
        files: [
          { name: "shot.png", type: "image/png", bytes: PNG },
          { name: "clip.mp4", type: "video/mp4", bytes: MP4 },
        ],
      }),
      { "x-forwarded-for": "203.0.113.7" },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: ISSUE });

    expect(gh.seen.map((s) => `${s.method} ${s.url.split("?")[0]}`)).toEqual([
      "GET https://api.github.com/repos/mouhcineToumi/anydag",
      "POST https://uploads.github.com/user-attachments/assets",
      "POST https://uploads.github.com/user-attachments/assets",
      "POST https://api.github.com/repos/mouhcineToumi/anydag/issues",
    ]);
    for (const s of gh.seen) expect(s.auth).toBe(`Bearer ${TOKEN}`);
    const upload = new URL(gh.seen[1]!.url);
    expect(Object.fromEntries(upload.searchParams)).toEqual({
      name: "shot.png",
      content_type: "image/png",
      repository_id: String(REPO_ID),
    });
    const issue = JSON.parse(gh.seen[3]!.body!) as { title: string; body: string; labels: string[] };
    expect(issue.title).toBe("Bug: The arrows vanish after a tidy.");
    expect(issue.labels).toEqual(["status: triage", "type: bug", "feedback"]);
    expect(issue.body).toContain("![shot.png](https://github.com/user-attachments/assets/00000001-");
    expect(issue.body).toContain("[clip.mp4](https://github.com/user-attachments/assets/00000002-");
    expect(issue.body).not.toContain("![clip.mp4]");
    expect(issue.body).toContain("<details><summary>Board: plan.board.md</summary>");
    expect(issue.body).toContain("````markdown\n```flow\nA --> B\n```\n````");
    expect(issue.body).toContain("AnyDag 0.3.0 · linux · x64");

    /* Stateless: not a file more in its folder, and nothing about the request in what it said. */
    expect(fs.readdirSync(h.root).sort()).toEqual(before);
  });

  it("files an idea as a feature", async () => {
    const gh = fakeGitHub();
    h = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN }, { fetch: gh.fetch });
    expect((await send(h, form({ kind: "idea", text: "A dark sidebar" }))).status).toBe(201);
    const issue = JSON.parse(gh.seen.at(-1)!.body!) as { title: string; labels: string[] };
    expect(issue.title).toBe("Idea: A dark sidebar");
    expect(issue.labels).toEqual(["status: triage", "type: feature", "feedback"]);
  });

  it("makes no issue when an upload fails", async () => {
    const gh = fakeGitHub({ upload: 500, uploadAt: 2 });
    h = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN }, { fetch: gh.fetch });
    const res = await send(
      h,
      form({
        kind: "bug",
        text: "x",
        files: [
          { name: "a.png", type: "image/png", bytes: PNG },
          { name: "b.png", type: "image/png", bytes: PNG },
        ],
      }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "ES_UPSTREAM", message: expect.stringContaining("no issue was made") });
    expect(gh.seen.some((s) => s.url.endsWith("/issues"))).toBe(false);
  });

  it("says so when the issue cannot be made", async () => {
    const gh = fakeGitHub({ issue: 403 });
    h = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN }, { fetch: gh.fetch });
    const res = await send(h, form({ kind: "bug", text: "x" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toBe(
      "GitHub refused to create the issue (403); no issue was made",
    );
  });

  it("refuses what it cannot take, with a 4xx and before GitHub is asked", async () => {
    const gh = fakeGitHub();
    h = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN }, { fetch: gh.fetch });
    const cases: [FormData | string, number, string][] = [
      [form({ kind: "rant", text: "x" }), 400, "the kind is bug or idea"],
      [form({ kind: "bug", text: "  " }), 400, "say what happened"],
      [
        form({ kind: "bug", text: "x", files: [{ name: "run.exe", type: "application/x-msdownload", bytes: PNG }] }),
        400,
        "`run.exe` is not",
      ],
      [
        form({
          kind: "bug",
          text: "x",
          files: Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, type: "image/png", bytes: PNG })),
        }),
        400,
        "at most 5 files",
      ],
      [form({ kind: "bug", text: "x", boards: "plan" }), 400, "boards must be a list"],
      ['{"kind":"bug"}', 400, "multipart"],
    ];
    let n = 0;
    for (const [body, status, says] of cases) {
      const from = { "x-forwarded-for": `192.0.2.${++n}` };
      const res = await send(h, body, typeof body === "string" ? { ...from, "content-type": "application/json" } : from);
      expect(res.status, says).toBe(status);
      expect(((await res.json()) as { message: string }).message).toContain(says);
    }
    /* Over the size, read no further than the cap. */
    const big = form({
      kind: "bug",
      text: "x",
      files: [{ name: "big.mp4", type: "video/mp4", bytes: new Uint8Array(11 * 1024 * 1024) }],
    });
    /* As bytes with no length said, the way a sender that streams it arrives: the cap is what stops it.
       (A `FormData` body cancelled mid-read makes undici enqueue into a closed stream, in a test only.) */
    const encoded = new Response(big);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const res = await Promise.resolve(
      h.app.request("/v1/feedback", {
        method: "POST",
        body: bytes as unknown as BodyInit,
        headers: { "x-forwarded-for": "192.0.2.99", "content-type": encoded.headers.get("content-type")! },
      }),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("ES_TOO_LARGE");
    expect(gh.seen).toEqual([]);
  });

  it("takes five a minute from one address and sixty in all", async () => {
    const gh = fakeGitHub();
    h = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN }, { fetch: gh.fetch });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await send(h, form({ kind: "bug", text: "x" }), { "x-forwarded-for": "198.51.100.1" })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    let others = 0;
    for (let i = 0; i < 60; i++)
      if ((await send(h, form({ kind: "bug", text: "x" }), { "x-forwarded-for": `198.51.100.${10 + i}` })).status === 201)
        others++;
    /* Sixty asked in the minute, the refused sixth above among them: fifty-four more here. */
    expect(others).toBe(54);
    h.clock.advance(60_000);
    expect((await send(h, form({ kind: "bug", text: "x" }), { "x-forwarded-for": "198.51.100.1" })).status).toBe(201);
  });

  it("is unavailable with no token, and not there when turned off", async () => {
    h = await harness("pglite", {});
    const res = await send(h, form({ kind: "bug", text: "x" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: "ES_UNAVAILABLE",
      message: expect.stringContaining("feedback not available"),
    });
    await h.close();
    h = await harness("pglite", { ANYDAG_FEEDBACK: "off", ANYDAG_FEEDBACK_GITHUB_TOKEN: TOKEN });
    expect((await send(h, form({ kind: "bug", text: "x" }))).status).toBe(404);
  });
});

describe("the issue", () => {
  const env = { version: "0.3.0", os: "darwin", arch: "arm64" };

  it("notifies nobody, and keeps a document's fences inside its own", () => {
    const body = issueBody({
      kind: "bug",
      text: "cc @octocat please",
      boards: [],
      notes: [{ name: "a <b>.note.md", text: "````js\nx\n````" }],
      files: [{ name: "x](evil).png", type: "image/png", url: "https://github.com/user-attachments/assets/1" }],
      env,
    });
    expect(body).toContain("cc @​octo");
    expect(body).not.toMatch(/@octocat/);
    expect(body).toContain("<summary>Note: a &lt;b&gt;.note.md</summary>");
    expect(body).toContain("`````markdown\n````js\nx\n````\n`````");
    expect(body).toContain("![x\\]\\(evil\\).png](https://github.com/user-attachments/assets/1)");
    expect(issueTitle("idea", `\n\n${"word ".repeat(40)}`)).toHaveLength("Idea: ".length + 80);
  });
});

describe("GitHub", () => {
  it("finds the attachment's address wherever the answer puts it", () => {
    const at = "https://github.com/user-attachments/assets/abc";
    expect(attachmentUrl({ href: at })).toBe(at);
    expect(attachmentUrl({ asset: { url: at } })).toBe(at);
    expect(attachmentUrl({ href: "https://example.com/x" })).toBeNull();
  });

  it("asks for the repository once, and again after a failure", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? Response.json({}, { status: 500 }) : Response.json({ id: 7 });
    }) as unknown as typeof fetch;
    const gh = new GitHub({ token: TOKEN, repo: "o/r", fetch: fetchImpl });
    await expect(gh.id()).rejects.toBeInstanceOf(GitHubError);
    expect(await gh.id()).toBe(7);
    expect(await gh.id()).toBe(7);
    expect(calls).toBe(2);
  });
});
