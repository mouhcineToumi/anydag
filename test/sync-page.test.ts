import { describe, expect, it } from "vitest";

import { hrefForPath, normaliseRecovery, passphraseProblem, sameRecovery, statusTone, statusWords } from "@/sync/status";
import type { SyncStatus } from "@/sync/types";

const base: SyncStatus = {
  vault: "v",
  linked: true,
  state: "idle",
  reason: null,
  server: "https://s",
  remote: "r",
  device: "d",
  pending: 0,
  conflicts: [],
  last: null,
};

describe("statusWords", () => {
  it("says what the state is", () => {
    expect(statusWords(null)).toBe("Not synced");
    expect(statusWords({ ...base, linked: false, state: "unlinked" })).toBe("Not synced");
    expect(statusWords(base)).toBe("Synced");
    expect(statusWords({ ...base, state: "syncing" })).toBe("Syncing…");
    expect(statusWords({ ...base, state: "offline" })).toBe("Offline");
    expect(statusWords({ ...base, state: "paused", reason: "out of quota" })).toBe("Paused: out of quota");
    expect(statusWords({ ...base, pending: 1 })).toBe("1 change waiting");
    expect(statusWords({ ...base, pending: 3 })).toBe("3 changes waiting");
  });
  it("puts conflicts first", () => {
    expect(statusWords({ ...base, pending: 2, conflicts: ["a.md"] })).toBe("1 conflict");
    expect(statusWords({ ...base, conflicts: ["a.md", "b.md"] })).toBe("2 conflicts");
  });
  it("tones", () => {
    expect(statusTone(base)).toBe("ok");
    expect(statusTone({ ...base, state: "syncing" })).toBe("busy");
    expect(statusTone({ ...base, conflicts: ["a"] })).toBe("warn");
    expect(statusTone({ ...base, state: "offline" })).toBe("warn");
  });
});

describe("the recovery code", () => {
  it("compares upper case without spaces or dashes", () => {
    expect(normaliseRecovery("ab12-cd 34")).toBe("AB12CD34");
    expect(sameRecovery("ab12 cd34", "AB12-CD34")).toBe(true);
    expect(sameRecovery("AB12", "AB13")).toBe(false);
    expect(sameRecovery("", "")).toBe(false);
  });
});

describe("the passphrase", () => {
  it("wants eight and a match", () => {
    expect(passphraseProblem("short", "short")).not.toBeNull();
    expect(passphraseProblem("longenough", "different1")).not.toBeNull();
    expect(passphraseProblem("longenough", "longenough")).toBeNull();
  });
});

describe("hrefForPath", () => {
  it("opens a path as what its name says", () => {
    expect(hrefForPath("a/b.board.md")).toBe("?board=a%2Fb");
    expect(hrefForPath("n.note.md")).toBe("?note=n");
    expect(hrefForPath("plain (conflict).md")).toBe("?note=plain%20(conflict)");
    expect(hrefForPath("q.quiz.md")).toBe("?quiz=q");
    expect(hrefForPath("t.table.md")).toBe("?table=t");
    expect(hrefForPath("attachments/x.pdf")).toBe("?file=attachments%2Fx.pdf");
  });
});
