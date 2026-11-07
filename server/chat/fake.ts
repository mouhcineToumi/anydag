/**
 * A scripted harness, for the e2e suite and for the runner's own tests (`ANYDAG_CHAT_FAKE=1`). It
 * spends no money and needs no login, and it reaches the vault **the way a real agent does**: over
 * HTTP to this server, with the chat's header, through the guard, the approvals and the recorder —
 * so a test of the fake is a test of everything but the model.
 *
 * The person's words are a script, one command per line; anything else is echoed back.
 *
 *     block <title>              start a block of changes
 *     note <name> <text…>        make a note
 *     edit <name> <text…>        rewrite a note
 *     delete <name>              delete a note (waits for approval)
 *     read <name>                read a note and cite it
 *     vault <id> [edit]          ask for another vault
 *     note@<vault> <name> <text…>   make a note in another vault
 *     wait                       hang until stopped
 *     fail <words…>              end the turn as a failure
 */

import type { Harness, HarnessEvent, RunEnd, RunOptions, Running } from "./harness";

const lastWords = (prompt: string): string => {
  const at = prompt.lastIndexOf("The person now says:\n\n");
  return at < 0 ? prompt : prompt.slice(at + "The person now says:\n\n".length);
};

export function fakeHarness(provider: "claude" | "opencode"): Harness {
  return {
    provider,
    fake: true,
    run(o: RunOptions, on: (e: HarnessEvent) => void): Running {
      let stopped = false;
      let wake: (() => void) | null = null;
      const port = o.mcp.env.ANYDAG_CHAT_PORT;
      const token = o.mcp.env.ANYDAG_TOKEN ?? "";
      let n = 0;
      const call = async (name: string, method: string, route: string, body?: unknown): Promise<any> => {
        const id = `fake-${++n}`;
        on({ kind: "tool", id, name, input: body ?? { route } });
        const res = await fetch(`http://127.0.0.1:${port}${route}`, {
          method,
          headers: { "x-anydag-token": token, "x-anydag-chat": o.chat, ...(body ? { "content-type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const text = await res.text();
        on({ kind: "result", id, output: text, error: !res.ok });
        try {
          return { ok: res.ok, json: JSON.parse(text) };
        } catch {
          return { ok: res.ok, json: null };
        }
      };
      const say = async (text: string) => {
        for (const word of text.split(/(?<= )/)) {
          if (stopped) return;
          on({ kind: "delta", text: word });
          await new Promise((r) => setTimeout(r, 5));
        }
        on({ kind: "text", text });
      };

      const done: Promise<RunEnd> = (async () => {
        on({ kind: "session", id: o.resume ?? o.fresh ?? `fake-session-${Date.now()}` });
        const said: string[] = [];
        for (const line of lastWords(o.prompt).split("\n").map((l) => l.trim()).filter(Boolean)) {
          if (stopped) break;
          const [cmd, ...rest] = line.split(/\s+/);
          const at = cmd!.includes("@") ? cmd!.split("@")[1] : undefined;
          const q = at ? `?vault=${encodeURIComponent(at)}` : "";
          switch (cmd!.split("@")[0]) {
            case "block":
              await call("change_block", "POST", "/__board/chat/block", { title: rest.join(" ") });
              break;
            case "note": {
              const r = await call("note_create", "POST", `/__board/create${q}`, { name: rest[0], kind: "note", text: `${rest.slice(1).join(" ")}\n` });
              said.push(r.ok ? `Made [${rest[0]}](dag:${r.json.id}).` : `Could not make ${rest[0]}: ${r.json?.error}`);
              break;
            }
            case "edit": {
              const got = await call("note_read", "GET", `/__board/get?name=${encodeURIComponent(rest[0]!)}&kind=note`);
              if (!got.ok) {
                said.push(`No note ${rest[0]}.`);
                break;
              }
              const r = await call("note_write", "POST", `/__board/put?name=${encodeURIComponent(rest[0]!)}&kind=note`, { base: got.json.base, text: `${rest.slice(1).join(" ")}\n` });
              said.push(r.ok ? `Rewrote ${rest[0]}.` : `Could not rewrite ${rest[0]}: ${r.json?.error}`);
              break;
            }
            case "delete": {
              const r = await call("note_delete", "POST", "/__board/delete", { name: rest[0], kind: "note" });
              said.push(r.ok ? `Deleted ${rest[0]}.` : `Did not delete ${rest[0]}: ${r.json?.error}`);
              break;
            }
            case "read": {
              const r = await call("note_read", "GET", `/__board/get?name=${encodeURIComponent(rest[0]!)}&kind=note`);
              const id = r.json?.id;
              said.push(r.ok ? `It says: ${String(r.json.text).trim()} — [${rest[0]}](dag:${id}).` : `No note ${rest[0]}.`);
              break;
            }
            case "vault": {
              const r = await call("vault_request", "POST", "/__board/chat/access", { vault: rest[0], why: "the script asked", mode: rest[1] === "edit" ? "edit" : "ask" });
              said.push(r.json?.granted ? `Granted ${rest[0]}.` : `Not granted: ${r.json?.error}`);
              break;
            }
            case "wait":
              await new Promise<void>((r) => (wake = r));
              break;
            case "fail":
              await say(rest.join(" "));
              return { error: rest.join(" ") || "the fake failed" };
            default:
              said.push(`You said: ${line}`);
          }
        }
        if (!stopped) await say(said.join("\n") || "Done.");
        return { usage: { input: o.prompt.length, output: said.join("").length } };
      })().catch((e: Error) => ({ error: e.message }));

      return {
        done,
        async stop() {
          stopped = true;
          (wake as (() => void) | null)?.();
          await done;
        },
      };
    },
    async forget() {},
    async close() {},
  };
}
