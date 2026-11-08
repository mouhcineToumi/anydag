import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **One Playwright version, said in three places, and they must agree.**
 *
 * The screenshots are made and compared inside `mcr.microsoft.com/playwright:v<version>-noble`: the
 * version `package.json` pins, which `scripts/e2e-docker.sh` reads, and which
 * `.github/workflows/e2e.yml` spells out because a workflow's `container:` cannot read a file. A
 * library bumped without the image — or the other way round — is a browser that draws every
 * baseline a few pixels differently, and a red suite that says nothing about why.
 */
const pinned = (JSON.parse(fs.readFileSync("package.json", "utf8")).devDependencies["@playwright/test"] as string) ?? "";

describe("the Playwright pin", () => {
  it("is an exact version, never a range", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the version the lockfile installs", () => {
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    expect(lock.packages["node_modules/@playwright/test"].version).toBe(pinned);
    expect(lock.packages["node_modules/playwright"].version).toBe(pinned);
  });

  it("is the version of the image the workflow runs in, and of the report merge", () => {
    const yml = fs.readFileSync(".github/workflows/e2e.yml", "utf8");
    const images = [...yml.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/g)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const v of images) expect(v).toBe(pinned);
    const merges = [...yml.matchAll(/@playwright\/test@([\d.]+)/g)].map((m) => m[1]);
    for (const v of merges) expect(v).toBe(pinned);
  });
});
