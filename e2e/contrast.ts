import type { Page } from "@playwright/test";

export interface ContrastAudit {
  text: number;
  placeholders: number;
  failures: string[];
}

/**
 * The WCAG contrast of every visible piece of text under `selector` (and every placeholder), against
 * the nearest opaque background behind it — the same thing axe's `color-contrast` rule reports,
 * without a dependency the project would have to carry. A subtree matching `skip` is left out, which
 * is how the chrome is measured without the diagram surface it is not allowed to change.
 *
 * The threshold is 4.5:1, or 3:1 for large text (24px, or 18.66px and bold). Disabled controls are
 * skipped: WCAG exempts them, and the app fades some with `opacity`, which would make a measured
 * ratio say less about the token than about the fade.
 */
export function auditContrast(page: Page, selector: string, skip?: string): Promise<ContrastAudit> {
  return page.evaluate(
    ({ rootSelector, skipSelector }) => {
      interface Rgb {
        r: number;
        g: number;
        b: number;
        a: number;
      }

      const parse = (value: string): Rgb | null => {
        const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
        if (!m) return null;
        const parts = m[1]!
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
        return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
      };

      const linear = (value: number): number => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (c: Rgb): number => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
      const contrast = (a: Rgb, b: Rgb): number => {
        const x = luminance(a);
        const y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const over = (c: Rgb, bg: Rgb): Rgb =>
        c.a >= 1
          ? c
          : {
              r: c.r * c.a + bg.r * (1 - c.a),
              g: c.g * c.a + bg.g * (1 - c.a),
              b: c.b * c.a + bg.b * (1 - c.a),
              a: 1,
            };
      const background = (el: Element): Rgb => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c && c.a >= 0.999) return c;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const where = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).join(".") : "";
        return classes ? `${tag}.${classes}` : tag;
      };
      const weightOf = (value: string): number =>
        value === "bold" ? 700 : value === "normal" ? 400 : Number.isNaN(Number(value)) ? 400 : Number(value);
      const large = (size: number, weight: number): boolean => size >= 24 || (size >= 18.66 && weight >= 700);
      const report = (el: Element, color: Rgb, bg: Rgb, size: number, weight: number): string | null => {
        const ratio = contrast(over(color, bg), bg);
        const need = large(size, weight) ? 3 : 4.5;
        if (ratio >= need) return null;
        return `${where(el)}: ${ratio.toFixed(2)}:1, needs ${need}:1 (${getComputedStyle(el).color} on rgb(${bg.r}, ${bg.g}, ${bg.b}))`;
      };
      const visible = (el: Element): boolean => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        if (Number(style.opacity) === 0) return false;
        return el.getClientRects().length > 0;
      };
      const disabled = (el: Element): boolean => !!el.closest(":disabled, [aria-disabled='true']");
      const skipped = (el: Element): boolean => !!skipSelector && !!el.closest(skipSelector);

      const root = document.querySelector(rootSelector);
      if (!root) return { text: 0, placeholders: 0, failures: [`nothing matched ${rootSelector}`] };

      const failures: string[] = [];
      let text = 0;
      let placeholders = 0;

      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        if (!(el instanceof HTMLElement) || disabled(el) || skipped(el) || !visible(el)) continue;
        const own = Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (!own) continue;
        const style = getComputedStyle(el);
        const color = parse(style.color);
        if (!color) continue;
        text++;
        const failure = report(el, color, background(el), parseFloat(style.fontSize), weightOf(style.fontWeight));
        if (failure) failures.push(`${failure} — "${own.replace(/\s+/g, " ").slice(0, 48)}"`);
      }

      for (const el of root.querySelectorAll<HTMLElement>("input[placeholder], textarea[placeholder]")) {
        if (!(el instanceof HTMLElement) || disabled(el) || skipped(el) || !visible(el)) continue;
        const style = getComputedStyle(el);
        const pseudo = getComputedStyle(el, "::placeholder");
        const color = parse(pseudo.color);
        if (!color) continue;
        placeholders++;
        const bg = background(el);
        const ratio = contrast(over(color, bg), bg);
        const need = large(
          parseFloat(pseudo.fontSize) || parseFloat(style.fontSize),
          weightOf(pseudo.fontWeight || style.fontWeight),
        )
          ? 3
          : 4.5;
        if (ratio < need) {
          failures.push(
            `${where(el)}::placeholder: ${ratio.toFixed(2)}:1, needs ${need}:1 (${pseudo.color} on rgb(${bg.r}, ${bg.g}, ${bg.b})) — "${el.getAttribute("placeholder")}"`,
          );
        }
      }

      return { text, placeholders, failures };
    },
    { rootSelector: selector, skipSelector: skip ?? "" },
  );
}
