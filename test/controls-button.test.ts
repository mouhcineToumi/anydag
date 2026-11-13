import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, IconButton, type ButtonSize, type ButtonVariant } from "@/ui/controls";

/**
 * The chrome's two buttons (#207). What is held here is the contract a screen leans on: the classes
 * the stylesheet draws each variant and size from, that every attribute the e2e suite finds a
 * control by passes through, and that an icon with no name never reaches the page in development.
 * The pixels are the stylesheet's and the screenshots'.
 */

const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

/** The opening tag of the `<button>`, where its attributes are. */
const tag = (markup: string) => markup.match(/<button[^>]*>/)?.[0] ?? "";

describe("Button", () => {
  const variants: ButtonVariant[] = ["primary", "secondary", "quiet", "danger"];
  const sizes: ButtonSize[] = ["sm", "md", "touch"];

  it("is a secondary at md, of type button, by default", () => {
    const t = tag(render(createElement(Button, null, "Cancel")));
    expect(t).toContain('type="button"');
    expect(t).toContain('class="dag-button dag-button--secondary dag-button--md"');
  });

  for (const variant of variants) {
    it(`draws the ${variant} variant from its class`, () => {
      const t = tag(render(createElement(Button, { variant }, "Go")));
      expect(t).toContain(`dag-button--${variant}`);
      for (const other of variants.filter((v) => v !== variant)) expect(t).not.toContain(`dag-button--${other}`);
    });
  }

  for (const size of sizes) {
    it(`draws the ${size} size from its class`, () => {
      const t = tag(render(createElement(Button, { size }, "Go")));
      expect(t).toContain(`dag-button--${size}`);
      for (const other of sizes.filter((v) => v !== size)) expect(t).not.toContain(`dag-button--${other}`);
    });
  }

  it("keeps a submit, the caller's class, and every hook the suite selects by", () => {
    const markup = render(
      createElement(
        Button,
        {
          type: "submit",
          variant: "primary",
          className: "dag-x",
          "data-dag-vault-open-go": "",
          title: "Open it",
          disabled: true,
        },
        "Open",
      ),
    );
    const t = tag(markup);
    expect(t).toContain('type="submit"');
    expect(t).toContain("dag-button--primary dag-button--md dag-x");
    expect(t).toContain('data-dag-vault-open-go=""');
    expect(t).toContain('title="Open it"');
    expect(t).toContain('disabled=""');
    expect(markup).toContain(">Open</button>");
  });
});

describe("IconButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a quiet md square named by its label, with the drawn tooltip and no title", () => {
    const markup = render(createElement(IconButton, { "aria-label": "Dismiss" }, "×"));
    const t = tag(markup);
    expect(t).toContain('class="dag-icon dag-icon--md"');
    expect(t).toContain('aria-label="Dismiss"');
    expect(t).toContain('type="button"');
    expect(t).not.toContain("title=");
    /* The drawn tooltip's anchor: the bubble itself appears only on hover or focus. */
    expect(markup.startsWith('<span class="dag-tip">')).toBe(true);
  });

  for (const size of ["sm", "md", "touch"] as const) {
    it(`draws the ${size} size from its class`, () => {
      expect(tag(render(createElement(IconButton, { "aria-label": "More", size }, "…")))).toContain(`dag-icon--${size}`);
    });
  }

  it("draws danger from its class, and quiet with none", () => {
    expect(tag(render(createElement(IconButton, { "aria-label": "Delete", variant: "danger" }, "x")))).toContain(
      "dag-icon--danger",
    );
    expect(tag(render(createElement(IconButton, { "aria-label": "Close" }, "x")))).not.toContain("dag-icon--danger");
  });

  it("keeps a title as the one tooltip, and draws none of its own", () => {
    const markup = render(createElement(IconButton, { "aria-label": "New", title: "New board, note or folder" }, "+"));
    expect(tag(markup)).toContain('title="New board, note or folder"');
    expect(markup).not.toContain("dag-tip");
  });

  it("refuses to render without a label in development, and says why", () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(import.meta.env.DEV).toBe(true);
    for (const label of ["", "   "]) {
      expect(render(createElement(IconButton, { "aria-label": label }, "x"))).toBe("");
    }
    /* A caller that forgets it entirely, past the type. */
    const unnamed = { children: "x" } as unknown as Parameters<typeof IconButton>[0];
    expect(render(createElement(IconButton, unnamed))).toBe("");
    expect(said).toHaveBeenCalledTimes(3);
    expect(String(said.mock.calls[0]?.[0])).toMatch(/aria-label/);
  });
});
