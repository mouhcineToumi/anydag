import { describe, expect, it } from "vitest";

import { checkedAgo, needsAttention, providerStatus } from "@/settings/providerStatus";

describe("a provider's pill", () => {
  it("is Ready when the server says so, whatever reason came with it", () => {
    expect(providerStatus({ ready: true })).toBe("ready");
  });

  it("names what is missing", () => {
    expect(providerStatus({ ready: false, reason: { code: "no-key" } })).toBe("needs-key");
    expect(providerStatus({ ready: false, reason: { code: "needs-base-url" } })).toBe("needs-address");
    expect(providerStatus({ ready: false, reason: { code: "not-signed-in" } })).toBe("not-signed-in");
    expect(providerStatus({ ready: false, reason: { code: "not-installed" } })).toBe("not-installed");
    expect(providerStatus({ ready: false, reason: { code: "too-old" } })).toBe("needs-update");
    expect(providerStatus({ ready: false })).toBe("not-ready");
  });
});

describe("the Settings dot", () => {
  const list = {
    default: "claude",
    providers: [
      { id: "claude", ready: false },
      { id: "opencode", ready: true },
      { id: "custom", ready: false },
    ],
  };

  it("shows when a provider somebody uses cannot answer, the default included", () => {
    expect(needsAttention(list, [null])).toBe(true);
    expect(needsAttention(list, ["opencode", "custom"])).toBe(true);
  });

  it("stays away for a provider nobody chose, however unready", () => {
    expect(needsAttention(list, ["opencode"])).toBe(false);
    expect(needsAttention(null, [null])).toBe(false);
  });
});

describe("when the list was checked", () => {
  it("reads as a person would say it", () => {
    expect(checkedAgo(null, 0)).toBe("not yet");
    expect(checkedAgo(1000, 3000)).toBe("just now");
    expect(checkedAgo(0, 12_000)).toBe("12 seconds ago");
    expect(checkedAgo(0, 70_000)).toBe("a minute ago");
    expect(checkedAgo(0, 180_000)).toBe("3 minutes ago");
  });
});
