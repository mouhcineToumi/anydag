/**
 * A file somebody named by URL, fetched by the server.
 *
 * `image_add` and `file_upload` took a file's bytes as base64 inside the tool call, so an agent read
 * a file into its context and wrote it out again verbatim — 110 KB of base64 through the model for
 * eight small SVGs, where one wrong character corrupts the file and says nothing. A `url` lets the
 * server fetch it instead, and that makes the server a client of whatever address it is handed: the
 * textbook server-side request forgery, aimed at this machine's own services or the local network.
 * So every rule here is a refusal:
 *
 * - **https only**, and no credentials in the URL.
 * - **Every address the name resolves to must be public** — not private, loopback, link-local,
 *   reserved, shared, multicast or unspecified, an IPv4 address dressed as IPv6 included — and **the
 *   connection is made to the address that was checked** (`lookup` answers with it), with the name
 *   kept for TLS and `Host`. A name resolved twice can answer differently the second time (DNS
 *   rebinding), and checking one answer and connecting to another is how a guard is walked round.
 * - **Each redirect is checked as the first URL was**, at most five of them.
 * - **Ten seconds for all of it**, and the bytes are counted as they arrive, so a file over the
 *   limit is refused at the first chunk over it rather than after it has all been read.
 *
 * What the file *is* stays the callers' business, decided off its extension exactly as an upload's
 * is (`uploads.ts`): this only fetches.
 */
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

/** A URL the server will not fetch, or a fetch that failed — said in words for whoever asked. */
export class FetchRefused extends Error {}

export interface Fetched {
  data: Buffer;
  /** The last segment of the URL's path, unquoted: what the file is called when nobody says. */
  filename: string;
  /** What the server said it was, which only names a file that has no extension of its own. */
  contentType: string;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

const BLOCKED = (() => {
  const b = new net.BlockList();
  for (const [net4, bits] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const) {
    b.addSubnet(net4, bits, "ipv4");
  }
  for (const [net6, bits] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
  ] as const) {
    b.addSubnet(net6, bits, "ipv6");
  }
  return b;
})();

/** Whether an address is one on the public internet — and so one the server may reach. */
export function isPublic(address: string): boolean {
  const bare = address.split("%", 1)[0]!;
  const family = net.isIP(bare);
  if (family === 4) return !BLOCKED.check(bare, "ipv4");
  if (family !== 6) return false;
  // An IPv4 address carried in IPv6 is the IPv4 address: `::ffff:127.0.0.1` is the loopback.
  const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped) return isPublic(mapped[1]!);
  const hex = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return isPublic(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return !BLOCKED.check(bare, "ipv6");
}

function filenameOf(pathname: string): string {
  const leaf = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

/** The file at `url`, at most `maxBytes` of it. Throws `FetchRefused` with why. */
export async function fetchFile(url: string, opts: { maxBytes: number; resolver?: Resolver }): Promise<Fetched> {
  const resolver = opts.resolver ?? defaultResolver;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;
  let first: string | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parts: URL;
      try {
        parts = new URL(current);
      } catch {
        throw new FetchRefused(`\`${current}\` is not a URL`);
      }
      if (parts.protocol !== "https:") throw new FetchRefused("only an https:// URL is fetched");
      if (parts.username || parts.password) throw new FetchRefused("a URL with a name or a password in it is not fetched");
      const host = parts.hostname.replace(/^\[|\]$/g, "");
      if (!host) throw new FetchRefused(`\`${current}\` names no host`);
      first ??= filenameOf(parts.pathname);

      let addresses: { address: string; family: number }[];
      if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
      else {
        try {
          addresses = await resolver(host);
        } catch {
          throw new FetchRefused(`\`${host}\` does not resolve`);
        }
      }
      if (addresses.length === 0) throw new FetchRefused(`\`${host}\` does not resolve`);
      if (!addresses.every((a) => isPublic(a.address))) {
        throw new FetchRefused(`\`${host}\` is not an address on the public internet, so it is not fetched from here`);
      }
      // IPv4 first where there is one: a machine may have no route out over IPv6.
      const pinned = addresses.find((a) => a.family === 4) ?? addresses[0]!;

      const answer = await get(parts, host, pinned, signal);
      if (answer.status >= 300 && answer.status < 400) {
        answer.res.resume();
        const location = answer.res.headers.location;
        if (!location) throw new FetchRefused(`\`${current}\` redirects nowhere`);
        current = new URL(location, current).href;
        continue;
      }
      if (answer.status >= 400) {
        answer.res.resume();
        throw new FetchRefused(`\`${current}\` answered ${answer.status}`);
      }
      const length = Number(answer.res.headers["content-length"]);
      if (Number.isFinite(length) && length > opts.maxBytes) {
        answer.res.destroy();
        throw new FetchRefused(`the file is ${length} bytes, over the limit of ${opts.maxBytes}`);
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of answer.res as AsyncIterable<Buffer>) {
        total += chunk.length;
        if (total > opts.maxBytes) {
          answer.res.destroy();
          throw new FetchRefused(`the file is over the limit of ${opts.maxBytes} bytes`);
        }
        chunks.push(chunk);
      }
      const type = String(answer.res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      return { data: Buffer.concat(chunks), filename: first ?? "", contentType: type };
    }
    throw new FetchRefused(`\`${url}\` redirects more than ${MAX_REDIRECTS} times`);
  } catch (e) {
    if (e instanceof FetchRefused) throw e;
    if (signal.aborted) throw new FetchRefused(`\`${url}\` did not answer within ${TIMEOUT_MS / 1000} seconds`);
    throw new FetchRefused(`\`${current}\` could not be fetched: ${(e as Error).message}`);
  }
}

/** One GET, to `pinned` and never to whatever the name resolves to next. */
function get(url: URL, host: string, pinned: { address: string; family: number }, signal: AbortSignal) {
  return new Promise<{ status: number; res: import("node:http").IncomingMessage }>((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: net.isIP(host) ? undefined : host,
        headers: { "User-Agent": "AnyDag", Accept: "*/*" },
        signal,
        // The address that was checked, whatever the name says now.
        lookup: (_name, options, cb) => {
          if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        },
      },
      (res) => resolve({ status: res.statusCode ?? 0, res }),
    );
    req.on("error", reject);
    req.end();
  });
}
