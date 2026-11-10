import { describe, expect, it } from "vitest";

import { ConfigError, configFrom, describe as describeConfig } from "../server/config";

/**
 * The config loader: the service's names, the old `ANYDAG_SYNC_*` names still taken, the
 * production checks, and the rule a secret's value never prints — in an error or at boot.
 */

const notes: string[] = [];
const warned = (message: string): void => {
  notes.push(message);
};

describe("configFrom", () => {
  it("reads every variable under its service name", () => {
    const c = configFrom(
      {
        ANYDAG_API_MODE: "multi",
        DATABASE_URL: "postgres://anydag:anydag@db:5432/anydag_api",
        ANYDAG_API_DATA: "/srv/anydag",
        ANYDAG_API_PORT: "8791",
        ANYDAG_API_HOST: "0.0.0.0",
        ANYDAG_API_HISTORY_DAYS: "60",
        ANYDAG_API_POKE: "off",
        ANYDAG_API_PUBLIC_URL: "https://api.anydag.com/",
        ANYDAG_API_MAX_BODY_MB: "64",
        ANYDAG_API_TRUST_PROXY: "1",
        ANYDAG_API_FEEDBACK: "",
      },
      "/tmp",
    );
    expect(c).toMatchObject({
      mode: "multi",
      databaseUrl: "postgres://anydag:anydag@db:5432/anydag_api",
      data: "/srv/anydag",
      port: 8791,
      host: "0.0.0.0",
      historyDays: 60,
      poke: false,
      publicUrl: "https://api.anydag.com",
      trustProxy: 1,
    });
    /* The features are on unless they are told off, and an empty switch is unset. */
    expect(c).toMatchObject({ sync: true, logs: true, feedback: true });
  });

  it("still reads an old ANYDAG_SYNC_* name, warning with names and no values", () => {
    const c = configFrom({ ANYDAG_SYNC_PORT: "1234", ANYDAG_SYNC_ADMIN_TOKEN: "old-name-admin-token" }, "/tmp", warned);
    expect(c.port).toBe(1234);
    expect(c.adminToken).toBe("old-name-admin-token");
    expect(notes.join("\n")).toContain("ANYDAG_SYNC_PORT is the old name of ANYDAG_API_PORT");
    expect(notes.join("\n")).toContain("ANYDAG_SYNC_ADMIN_TOKEN is the old name of ANYDAG_API_ADMIN_TOKEN");
    /* The value never reaches the boot line, whatever its name. */
    for (const row of notes) expect(row).not.toContain("old-name-admin-token");
  });

  it("prefers the new name when both are set, and says the old one is ignored", () => {
    const c = configFrom({ ANYDAG_SYNC_PORT: "1234", ANYDAG_API_PORT: "4321" }, "/tmp", warned);
    expect(c.port).toBe(4321);
    expect(notes.join("\n")).toContain("both are set");
  });

  it("refuses an unspellable value with the variable's name", () => {
    expect(() => configFrom({ ANYDAG_API_PORT: "abc" }, "/tmp")).toThrow(ConfigError);
    expect(() => configFrom({ ANYDAG_API_PORT: "abc" }, "/tmp")).toThrow(/ANYDAG_API_PORT/);
    expect(() => configFrom({ ANYDAG_API_FEEDBACK: "maybe" }, "/tmp")).toThrow(/ANYDAG_API_FEEDBACK/);
    expect(() => configFrom({ ANYDAG_API_TRUST_PROXY: "9" }, "/tmp")).toThrow(/ANYDAG_API_TRUST_PROXY/);
    expect(() => configFrom({ NODE_ENV: "production", ANYDAG_API_ADMIN_TOKEN: "short-but-legal-16" }, "/tmp")).toThrow(
      /at least 32 characters/,
    );
  });

  it("never puts a secret's value in an error", () => {
    const token = "prod-token-short-of-32";
    try {
      configFrom({ NODE_ENV: "production", ANYDAG_API_ADMIN_TOKEN: token }, "/tmp");
      expect.unreachable("a short production token must be refused");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("ANYDAG_API_ADMIN_TOKEN");
      expect(message).not.toContain(token);
      expect(message).toContain("<redacted>");
    }
  });

  it("gives the admin token 16 characters before production and 32 in it", () => {
    expect(configFrom({ ANYDAG_API_ADMIN_TOKEN: "a".repeat(16) }, "/tmp").adminToken).not.toBeNull();
    const long = configFrom({ NODE_ENV: "production", ANYDAG_API_ADMIN_TOKEN: "a".repeat(32) }, "/tmp");
    expect(long.adminToken).toHaveLength(32);
    expect(long.production).toBe(true);
  });

  it("takes a trust proxy as off or a hop count, and refuses the rest", () => {
    expect(configFrom({}, "/tmp").trustProxy).toBe(0);
    expect(configFrom({ ANYDAG_API_TRUST_PROXY: "off" }, "/tmp").trustProxy).toBe(0);
    expect(configFrom({ ANYDAG_API_TRUST_PROXY: "2" }, "/tmp").trustProxy).toBe(2);
    expect(() => configFrom({ ANYDAG_API_TRUST_PROXY: "9" }, "/tmp")).toThrow(ConfigError);
    expect(() => configFrom({ ANYDAG_API_TRUST_PROXY: "maybe" }, "/tmp")).toThrow(ConfigError);
  });

  it("turns a feature off", () => {
    const c = configFrom({ ANYDAG_API_SYNC: "off", ANYDAG_API_LOGS: "0", ANYDAG_API_FEEDBACK: "false" }, "/tmp");
    expect(c).toMatchObject({ sync: false, logs: false, feedback: false });
  });

  it("creates the feedback relay's posture from its two secrets", () => {
    expect(configFrom({}, "/tmp")).toMatchObject({ feedbackToken: null, feedbackRepo: null });
    const full = configFrom(
      { ANYDAG_API_FEEDBACK_GITHUB_TOKEN: "a-fake-feedback-token-value", ANYDAG_API_FEEDBACK_REPO: "owner/repo" },
      "/tmp",
    );
    expect(full).toMatchObject({ feedbackToken: "a-fake-feedback-token-value", feedbackRepo: "owner/repo" });
    expect(() => configFrom({ ANYDAG_API_FEEDBACK_REPO: "not a repo" }, "/tmp")).toThrow(
      /ANYDAG_API_FEEDBACK_REPO must be owner\/name/,
    );
  });
});

describe("describe", () => {
  it("prints the config with every secret redacted", () => {
    const c = configFrom(
      {
        DATABASE_URL: "postgres://anydag:the-db-password@db:5432/anydag_api",
        ANYDAG_API_ADMIN_TOKEN: "admin-token-value-hidden",
        ANYDAG_API_FEEDBACK_GITHUB_TOKEN: "a-fake-feedback-token-value",
        ANYDAG_API_FEEDBACK_REPO: "owner/repo",
        ANYDAG_API_TRUST_PROXY: "1",
        ANYDAG_API_PUBLIC_URL: "https://api.anydag.com",
        ANYDAG_API_FEEDBACK: "off",
      },
      "/tmp",
    );
    const printed = describeConfig(c).join("\n");
    for (const secret of ["the-db-password", "admin-token-value-hidden", "a-fake-feedback-token-value"])
      expect(printed).not.toContain(secret);
    expect(printed).toContain("postgres://…@db:5432/anydag_api");
    expect(printed).toContain("admin: <redacted>");
    expect(printed).toContain("trust proxy: 1");
    expect(printed).toContain("features: sync on, logs on, feedback off");
  });

  it("says when the feedback relay is switched on but missing its secret", () => {
    const c = configFrom({ ANYDAG_API_FEEDBACK: "on" }, "/tmp");
    const printed = describeConfig(c).join("\n");
    expect(printed).toContain("<no repo>");
    expect(printed).toContain("token <unset>");
    expect(printed).toContain("503");
  });
});
