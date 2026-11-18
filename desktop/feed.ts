/**
 * The releases a chosen update channel reads (#525).
 *
 * electron-updater's GitHub provider decides which release to look at from one word: the updater's
 * `channel` when one was set, or else the running version's own pre-release word. A nightly build
 * looks only at nightlies, a beta build at betas and stable releases, a stable build at stable
 * releases — and a stable build that merely allows pre-releases takes whatever release is newest,
 * a beta as readily as a nightly. So `allowPrerelease` alone cannot make a stable build follow
 * nightlies, nor a nightly build go back to stable: the provider has to be told the channel.
 *
 * The updater's own `channel` is the one way to tell it, and its setter turns on `allowDowngrade`,
 * which a person must never get without saying yes to it (`desktop/updates.ts`, `downgrade`). This
 * provider is the GitHub one, unchanged, handed a *view* of the updater whose `channel` is the word
 * the person chose — every other property read through to the real updater, so `allowPrerelease`
 * and `currentVersion` are live — while the real updater's `channel` stays unset and its
 * `allowDowngrade` stays off. `main.ts` installs it with `setFeedURL` only when the person chose a
 * channel other than the version's own; with no choice the updater keeps the provider
 * `app-update.yml` gave it.
 */

import type { AppUpdater } from "electron-updater";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";

import type { UpdateChannel } from "./updates";

type GithubOptions = ConstructorParameters<typeof GitHubProvider>[0];

/** Where the releases are: `publish` in `desktop/electron-builder.yml`. */
export const RELEASES = { owner: "mouhcineToumi", repo: "anydag" } as const;

/** What `setFeedURL` is handed: the `custom` provider below, and what it reads. */
interface ChannelFeedOptions {
  provider: "custom";
  updateProvider: typeof ChannelGitHubProvider;
  owner: string;
  repo: string;
  /** The update file's name as `app-update.yml` has it: the version's own channel, absent for stable. */
  channel?: string;
  /** The channel followed, or `null` for the version's own (then this is the GitHub provider exactly). */
  follow: UpdateChannel | null;
}

/** The updater as the provider sees it: the same object, but with `channel` answering `follow`. */
export function followingUpdater(updater: AppUpdater, follow: string | null): AppUpdater {
  if (follow === null) return updater;
  /* An own data property shadows the prototype's accessor: the setter, and so `allowDowngrade`, is
     never reached, and the real updater is not written at all. */
  return Object.create(updater, { channel: { value: follow, enumerable: true } }) as AppUpdater;
}

export class ChannelGitHubProvider extends GitHubProvider {
  constructor(options: { [key: string]: unknown }, updater: AppUpdater, runtimeOptions: ProviderRuntimeOptions) {
    const { follow, updateProvider: _provider, ...rest } = options;
    super(
      { ...rest, provider: "github" } as GithubOptions,
      followingUpdater(updater, typeof follow === "string" ? follow : null),
      runtimeOptions,
    );
  }
}

/** The feed for `follow` on a build whose own channel is `own`. */
export function channelFeed(follow: UpdateChannel | null, own: string): ChannelFeedOptions {
  return {
    provider: "custom",
    updateProvider: ChannelGitHubProvider,
    ...RELEASES,
    ...(own === "latest" ? {} : { channel: own }),
    follow: follow === own ? null : follow,
  };
}
