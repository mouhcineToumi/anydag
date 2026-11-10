/**
 * The feedback relay's GitHub: one repository, a maintainer's token, and three calls — the
 * repository's id, a file's upload, an issue's creation. `fetch` is handed in, so a test answers
 * every call with GitHub's recorded shapes and nothing leaves the machine.
 *
 * Load-bearing:
 * - **A file is uploaded the way the issue editor uploads one**: `POST` to the user-attachments
 *   endpoint on `uploads.github.com` with the repository's id, and the
 *   `https://github.com/user-attachments/assets/…` address that comes back *is* the attachment. The
 *   endpoint is not in GitHub's documented API and is scoped to the token's user, which is why the
 *   relay holds a person's fine-grained token (Issues: write) and not an App's.
 * - **Nothing is kept**: no file, no row, no log line holds a byte of a submission. The repository's
 *   numeric id is the one thing remembered between requests, and it is not a submission's.
 * - **Every failure is a `GitHubError` with GitHub's status**, and its message is ours, never the
 *   body GitHub answered with — which could echo what was sent.
 */

export interface GitHubOptions {
  token: string;
  /** `owner/name`. */
  repo: string;
  fetch?: typeof fetch;
  api?: string;
  uploads?: string;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 60_000;

/** The attachment's address in an upload's answer, wherever GitHub put it. */
export function attachmentUrl(answer: unknown): string | null {
  const isAttachment = (v: unknown): v is string =>
    typeof v === "string" && /^https:\/\/github\.com\/user-attachments\/\S+$/.test(v);
  if (answer && typeof answer === "object") {
    const a = answer as Record<string, unknown>;
    for (const k of ["href", "url", "browser_download_url"]) if (isAttachment(a[k])) return a[k];
    for (const v of Object.values(a)) {
      if (isAttachment(v)) return v;
      const deeper = v && typeof v === "object" ? attachmentUrl(v) : null;
      if (deeper) return deeper;
    }
  }
  return null;
}

export class GitHub {
  private readonly fetch: typeof fetch;
  private readonly api: string;
  private readonly uploads: string;
  private repoId: Promise<number> | null = null;

  constructor(private readonly o: GitHubOptions) {
    this.fetch = o.fetch ?? fetch;
    this.api = o.api ?? "https://api.github.com";
    this.uploads = o.uploads ?? "https://uploads.github.com";
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.o.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "anydag-feedback-relay",
      ...extra,
    };
  }

  private async call(what: string, url: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GitHubError(0, `GitHub could not be reached to ${what}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new GitHubError(res.status, `GitHub refused to ${what} (${res.status})`);
    }
    try {
      return await res.json();
    } catch {
      throw new GitHubError(res.status, `GitHub's answer to ${what} was not JSON`);
    }
  }

  /** The repository's numeric id, which the upload endpoint asks for; asked once. */
  id(): Promise<number> {
    this.repoId ??= this.call("read the repository", `${this.api}/repos/${this.o.repo}`, { headers: this.headers() }).then(
      (got) => {
        const id = (got as { id?: unknown }).id;
        if (typeof id !== "number") throw new GitHubError(502, "GitHub's answer about the repository had no id");
        return id;
      },
    );
    this.repoId.catch(() => {
      this.repoId = null;
    });
    return this.repoId;
  }

  /** One file, as the issue editor uploads it; its `user-attachments` address. */
  async upload(name: string, type: string, bytes: Uint8Array): Promise<string> {
    const q = new URLSearchParams({ name, content_type: type, repository_id: String(await this.id()) });
    const got = await this.call("upload a file", `${this.uploads}/user-attachments/assets?${q}`, {
      method: "POST",
      headers: this.headers({ "content-type": type }),
      body: bytes as unknown as BodyInit,
    });
    const url = attachmentUrl(got);
    if (!url) throw new GitHubError(502, "GitHub's answer to an upload named no attachment");
    return url;
  }

  /** The issue, labelled; its page. */
  async issue(title: string, body: string, labels: string[]): Promise<string> {
    const got = await this.call("create the issue", `${this.api}/repos/${this.o.repo}/issues`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ title, body, labels }),
    });
    const url = (got as { html_url?: unknown }).html_url;
    if (typeof url !== "string") throw new GitHubError(502, "GitHub's answer about the issue had no address");
    return url;
  }
}
