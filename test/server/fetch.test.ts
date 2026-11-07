/** The guard in front of a fetch by URL: every refusal, and none of it touching a network. */
import { describe, expect, it } from "vitest";

import { fetchFile, isPublic, type Resolver } from "../../server/fetch";

const to = (...addresses: string[]): Resolver => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const refused = (url: string, resolver?: Resolver) => fetchFile(url, { maxBytes: 1024, resolver }).then(() => "fetched", (e: Error) => e.message);

describe("isPublic", () => {
  it("lets a public address through", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "151.101.1.69", "2606:4700:4700::1111", "2a00:1450:4007:80f::200e"]) expect(isPublic(a), a).toBe(true);
  });

  it("refuses this machine, the network it is on, and every range nobody routes", () => {
    for (const a of [
      "127.0.0.1", "127.8.9.10", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9",
      "224.0.0.1", "240.0.0.1", "255.255.255.255",
      "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "2002:7f00:1::1", "64:ff9b::7f00:1",
    ]) expect(isPublic(a), a).toBe(false);
  });

  it("reads an IPv4 address carried in IPv6 as the IPv4 address", () => {
    expect(isPublic("::ffff:127.0.0.1")).toBe(false);
    expect(isPublic("::ffff:7f00:1")).toBe(false);
    expect(isPublic("::ffff:192.168.0.1")).toBe(false);
    expect(isPublic("::ffff:8.8.8.8")).toBe(true);
  });

  it("refuses anything that is not an address", () => {
    expect(isPublic("localhost")).toBe(false);
    expect(isPublic("")).toBe(false);
  });
});

describe("fetchFile refuses before it connects", () => {
  it("takes https only, and no name or password in the URL", async () => {
    expect(await refused("http://example.com/a.png")).toMatch(/only an https/);
    expect(await refused("file:///etc/passwd")).toMatch(/only an https/);
    expect(await refused("https://me:secret@example.com/a.png", to("93.184.216.34"))).toMatch(/password/);
    expect(await refused("not a url")).toMatch(/is not a URL/);
  });

  it("refuses an address on this machine or a private network, written or resolved", async () => {
    expect(await refused("https://127.0.0.1/a.png")).toMatch(/not an address on the public internet/);
    expect(await refused("https://[::1]/a.png")).toMatch(/not an address on the public internet/);
    expect(await refused("https://[::ffff:169.254.169.254]/latest")).toMatch(/not an address on the public internet/);
    expect(await refused("https://internal.example/a.png", to("10.0.0.5"))).toMatch(/`internal.example` is not an address/);
  });

  it("refuses a name when any one of its addresses is private", async () => {
    expect(await refused("https://rebind.example/a.png", to("93.184.216.34", "127.0.0.1"))).toMatch(/not an address on the public internet/);
  });

  it("says when a name does not resolve", async () => {
    expect(await refused("https://nowhere.example/a.png", async () => { throw new Error("ENOTFOUND"); })).toMatch(/does not resolve/);
    expect(await refused("https://empty.example/a.png", to())).toMatch(/does not resolve/);
  });
});
