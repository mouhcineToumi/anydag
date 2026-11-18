import type { AppUpdater } from "electron-updater";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";
import { describe, expect, it } from "vitest";

import { ChannelGitHubProvider, channelFeed, followingUpdater, RELEASES } from "../desktop/feed";

/**
 * Which release a chosen update channel reads (#525), against a fake GitHub: the releases feed, the
 * `/releases/latest` redirect's answer, and each release's update file. The provider is
 * electron-updater's own GitHub provider; what is held is that the channel the person chose — not
 * the running version's word — picks the release, and that the real updater's `channel` is never set
 * (its setter turns on `allowDowngrade`).
 */

/** Newest first, as GitHub's feed lists them: a beta is the newest, so "the newest of anything" is wrong. */
const TAGS = ["v0.8.0-beta.2", "v0.8.0-nightly.202611180230", "v0.8.0-nightly.202611170230", "v0.7.0"];

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${TAGS.map(
  (tag) => `  <entry>
    <id>tag:github.com,2008:Repository/1/${tag}</id>
    <link rel="alternate" type="text/html" href="https://github.com/${RELEASES.owner}/${RELEASES.repo}/releases/tag/${tag}"/>
    <title>${tag}</title>
    <content type="html">No content.</content>
  </entry>`,
).join("\n")}
</feed>`;

/** Which update files each release carries: its own channel's (Windows names them without a suffix). */
const filesOf = (tag: string): string[] => {
  const word = /-([a-z]+)\./.exec(tag)?.[1];
  return word ? [`${word}.yml`] : ["latest.yml"];
};

const yml = (version: string) =>
  `version: ${version}\nfiles:\n  - url: AnyDag-Setup-${version}.exe\n    sha512: x\n    size: 1\npath: AnyDag-Setup-${version}.exe\nsha512: x\nreleaseDate: '2026-11-18T02:30:00.000Z'\n`;

function fakeGitHub() {
  const asked: string[] = [];
  const base = `/${RELEASES.owner}/${RELEASES.repo}/releases`;
  const executor = {
    async request(options: { path?: string }): Promise<string | null> {
      const at = options.path ?? "";
      asked.push(at);
      if (at === `${base}.atom`) return feedXml;
      if (at === `${base}/latest`) return JSON.stringify({ tag_name: "v0.7.0" });
      const file = new RegExp(`^${base}/download/(v[^/]+)/([^/]+)$`).exec(at);
      if (file && filesOf(file[1]).includes(file[2])) return yml(file[1].slice(1));
      throw new Error(`404 ${at}`);
    },
  };
  const runtime = { isUseMultipleRangeRequest: false, platform: "win32", executor } as unknown as ProviderRuntimeOptions;
  return { asked, runtime };
}

/** The slice of `AppUpdater` the GitHub provider reads, with the real one's `channel` setter: it turns
 *  on `allowDowngrade`, and here it also says it was called. */
function fakeUpdater(current: string, allowPrerelease: boolean) {
  const updater = {
    currentVersion: current,
    allowPrerelease,
    allowDowngrade: false,
    fullChangelog: false,
    channelSet: 0,
    _channel: null as string | null,
    get channel(): string | null {
      return this._channel;
    },
    set channel(value: string | null) {
      this.channelSet++;
      this._channel = value;
      this.allowDowngrade = true;
    },
  };
  return updater;
}

/** What `setFeedURL` would build from `channelFeed`: the provider factory's `custom` case. */
function providerFor(follow: "latest" | "beta" | "nightly" | null, current: string, allowPrerelease: boolean) {
  const own = /^\d+\.\d+\.\d+-([a-z]+)/.exec(current)?.[1] ?? "latest";
  const { asked, runtime } = fakeGitHub();
  const updater = fakeUpdater(current, allowPrerelease);
  const feed = channelFeed(follow, own);
  const provider = new feed.updateProvider(feed as unknown as Record<string, unknown>, updater as unknown as AppUpdater, runtime);
  return { provider, updater, asked };
}

describe("the channel a person chose picks the release", () => {
  it("a stable build set to Nightly is offered the newest nightly, not the newest of anything", async () => {
    const { provider, updater } = providerFor("nightly", "0.7.0", true);
    const info = await provider.getLatestVersion();
    expect(info.version).toBe("0.8.0-nightly.202611180230");
    expect(updater.channelSet).toBe(0);
    expect(updater.allowDowngrade).toBe(false);
  });

  it("…which is what electron-updater alone would get wrong: it takes the beta", async () => {
    const { runtime } = fakeGitHub();
    const plain = new GitHubProvider(
      { provider: "github", ...RELEASES },
      fakeUpdater("0.7.0", true) as unknown as AppUpdater,
      runtime,
    );
    expect((await plain.getLatestVersion()).version).toBe("0.8.0-beta.2");
  });

  it("a nightly build set to Stable reads the newest stable release and its latest.yml", async () => {
    const { provider, updater, asked } = providerFor("latest", "0.8.0-nightly.202611170230", false);
    const info = await provider.getLatestVersion();
    expect(info.version).toBe("0.7.0");
    /* Not `nightly.yml`, which is what the nightly's own app-update.yml names and a stable release lacks. */
    expect(asked.some((p) => p.endsWith("/v0.7.0/latest.yml"))).toBe(true);
    expect(asked.some((p) => p.endsWith("nightly.yml"))).toBe(false);
    expect(updater.channelSet).toBe(0);
    expect(updater.allowDowngrade).toBe(false);
  });

  it("a beta build set to Nightly reads nightlies, which its own word would skip", async () => {
    const { provider } = providerFor("nightly", "0.8.0-beta.1", true);
    expect((await provider.getLatestVersion()).version).toBe("0.8.0-nightly.202611180230");
  });

  it("a nightly build set to Beta reads betas and stable releases, never a nightly", async () => {
    const { provider } = providerFor("beta", "0.8.0-nightly.202611170230", true);
    expect((await provider.getLatestVersion()).version).toBe("0.8.0-beta.2");
  });

  it("the version's own channel is the GitHub provider exactly: the updater is handed over as it is", async () => {
    const { provider, updater } = providerFor("nightly", "0.8.0-nightly.202611170230", true);
    expect(channelFeed("nightly", "nightly").follow).toBeNull();
    expect((await provider.getLatestVersion()).version).toBe("0.8.0-nightly.202611180230");
    const real = fakeUpdater("0.7.0", false) as unknown as AppUpdater;
    expect(followingUpdater(real, null)).toBe(real);
    expect(updater.channelSet).toBe(0);
  });
});

describe("the view of the updater", () => {
  it("answers the chosen channel, reads everything else live, and writes nothing to the updater", () => {
    const real = fakeUpdater("0.7.0", false);
    const view = followingUpdater(real as unknown as AppUpdater, "nightly");
    expect(view.channel).toBe("nightly");
    expect(real.channel).toBeNull();
    real.allowPrerelease = true;
    expect(view.allowPrerelease).toBe(true);
    expect(real.channelSet).toBe(0);
    expect(real.allowDowngrade).toBe(false);
  });

  it("names the build's own update file the way app-update.yml does", () => {
    expect(channelFeed("nightly", "latest")).toMatchObject({ provider: "custom", ...RELEASES, follow: "nightly" });
    expect(channelFeed("nightly", "latest")).not.toHaveProperty("channel");
    expect(channelFeed("latest", "nightly")).toMatchObject({ channel: "nightly", follow: "latest" });
    expect(channelFeed("latest", "nightly").updateProvider).toBe(ChannelGitHubProvider);
  });
});
