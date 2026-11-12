import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HUE_ORDER } from "@/dsl/ir";
import { Mark, VaultProblem, monogram, shortPath, vaultHue } from "@/ui/Vaults";

/**
 * The vault switcher tells vaults apart. A name's first letter did not: *vault*, *vault-two* and
 * *Vault (old)* were three V's on one colour, and a screen reader read the home directory before the
 * name. These hold the four pieces that answer it without a browser: the two-letter monogram, the
 * hue from the id, the shortened path, and the refusal's inline code.
 */

describe("a vault's mark", () => {
  it("keeps two letters, so names that start alike are still different", () => {
    expect(monogram("vault")).toBe("VA");
    expect(monogram("vault-two")).toBe("VT");
    expect(monogram("Vault (old)")).toBe("VO");
    expect(monogram("My notes")).toBe("MN");
    expect(monogram("  ")).toBe("·");
    expect(monogram("Vault one")).not.toBe(monogram("Vault two"));
  });

  it("takes a hue from the id, the same id always the same one", () => {
    const id = "0b7c1f6e-vault";
    expect(vaultHue(id)).toBe(vaultHue(id));
    expect(HUE_ORDER).toContain(vaultHue(id));
    expect(new Set(Array.from({ length: 20 }, (_, i) => vaultHue(`vault-${i}`))).size).toBeGreaterThan(1);
  });

  it("draws the letters on the theme's tint, ringed in its hue", () => {
    const id = "mark-one";
    const hue = vaultHue(id);
    const markup = renderToStaticMarkup(createElement(Mark, { id, name: "vault-two" }));
    expect(markup).toContain(">VT<");
    expect(markup).toContain(`--vault-h:var(--dag-color-hues-${hue})`);
    expect(markup).toContain(`--vault-t:var(--dag-tint-${hue})`);
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("a vault's path", () => {
  it("calls home ~ and keeps the folder's own name", () => {
    expect(shortPath("/home/me/code/anydag/boards/local", "/home/me")).toBe("~/…/local");
    expect(shortPath("/home/me/notes", "/home/me")).toBe("~/notes");
    expect(shortPath("/home/me", "/home/me")).toBe("~");
    expect(shortPath("/mnt/data/team/notes", "/home/me")).toBe("/…/notes");
  });

  it("does not take a folder next door for one under home", () => {
    expect(shortPath("/home/melanie", "/home/me")).toBe("/home/melanie");
    expect(shortPath("/home/melanie/notes", "/home/me")).toBe("/…/notes");
  });
});

describe("a vault's refusal", () => {
  it("draws the server's backticks as inline code", () => {
    const markup = renderToStaticMarkup(
      createElement(VaultProblem, { text: "`/tmp/nope` is not a folder, and `/tmp/other` is not empty" }),
    );
    expect(markup).toContain("<code>/tmp/nope</code>");
    expect(markup).toContain("<code>/tmp/other</code>");
    expect(markup).not.toContain("`");
  });

  it("leaves the form's reserved line empty without claiming a problem", () => {
    const markup = renderToStaticMarkup(createElement(VaultProblem, { text: null, className: "dag-vault__form-error" }));
    expect(markup).toContain('class="dag-vault__form-error"');
    expect(markup).not.toContain("data-dag-vault-problem");
  });
});
