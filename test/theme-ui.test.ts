import { describe, expect, it } from "vitest";

import { applyTheme } from "@/theme/applyTheme";
import type { Theme } from "@/theme/contract";
import dark from "../themes/paper-dark/theme.json";
import neutral from "../themes/neutral/theme.json";
import paper from "../themes/paper/theme.json";

/**
 * The chrome's scale, `theme.ui` (#205): every theme has the same steps, and `applyTheme` writes
 * each one with its group's unit — the reason the groups carry the unit and not the leaves, since
 * `md` is both a font size and a control height.
 */

const THEMES = [paper, neutral, dark] as unknown as Theme[];

/** Enough of an element for `applyTheme`: a style that iterates its names, and a dataset. */
function fakeRoot() {
  const props = new Map<string, string>();
  const style = {
    setProperty: (k: string, v: string) => void props.set(k, v),
    removeProperty: (k: string) => void props.delete(k),
    colorScheme: "",
    [Symbol.iterator]: () => props.keys(),
  };
  return { root: { style, dataset: {} } as unknown as HTMLElement, props };
}

function steps(theme: Theme): string[] {
  return Object.entries(theme.ui).flatMap(([group, table]) => Object.keys(table).map((step) => `${group}.${step}`));
}

describe("theme.ui", () => {
  it("has the same groups and steps in every theme", () => {
    const want = steps(THEMES[0]!).sort();
    expect(want.length).toBeGreaterThan(30);
    for (const theme of THEMES) expect(steps(theme).sort()).toEqual(want);
  });

  it("is written as --dag-ui-<group>-<step> with the group's unit", () => {
    const { root, props } = fakeRoot();
    applyTheme(THEMES[0]!, root);
    expect(props.get("--dag-ui-text-md")).toBe("13px");
    expect(props.get("--dag-ui-leading-md")).toBe("20px");
    expect(props.get("--dag-ui-weight-strong")).toBe("600");
    expect(props.get("--dag-ui-radius-control")).toBe("9px");
    expect(props.get("--dag-ui-layer-popover")).toBe("20");
    expect(props.get("--dag-ui-motion-fast")).toBe("120ms");
    expect(props.get("--dag-ui-motion-ease")).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(props.get("--dag-ui-control-touch")).toBe("44px");
    expect(props.get("--dag-ui-space-2")).toBe("8px");
    expect(props.get("--dag-ui-elevation-overlay")).toBe("0 4px 16px var(--dag-color-shadow)");
  });

  it("draws every elevation in the theme's shadow colour, so dark themes keep their depth", () => {
    for (const theme of THEMES) {
      for (const value of Object.values(theme.ui.elevation)) expect(value).toContain("var(--dag-color-shadow)");
    }
  });

  it("keeps the layers in order: chrome under popovers under dialogs under toasts under tooltips", () => {
    for (const theme of THEMES) {
      const { chrome, popover, modal, toast, tooltip } = theme.ui.layer;
      expect([chrome, popover, modal, toast, tooltip]).toEqual([chrome, popover, modal, toast, tooltip].sort((a, b) => a - b));
      expect(chrome).toBeGreaterThanOrEqual(10);
    }
  });
});
