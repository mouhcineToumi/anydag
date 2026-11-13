import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { settingsTab, type SettingsTab } from "./sidebar";
import { vaulted } from "./vault";

/**
 * Settings on a phone (#188), measured at 390 × 844.
 *
 * The modal is a full-screen sheet under 720px, so every control it draws has to be a finger's:
 * 44 × 44 at least. `scan()` measures each interactive element's own border box — the phone layout
 * gives a switch and a check a 44 × 44 input with a smaller picture drawn inside it, so no target
 * depends on a hit area borrowed from a pseudo-element and there is no extension to add on.
 *
 * The other half is that the sheet never scrolls sideways, on any tab: the AI providers' key rows
 * and Agent access's command are the two that used to be wide enough to try.
 */

const PHONE = { width: 390, height: 844 };

const BOARD = `---
title: Settings phone scratch
---

\`\`\`md {#one x=0 y=0 w=320}
A note.
\`\`\`
`;

/** A provider list with a CLI, a keyed provider and the OpenAI-compatible row the key fields need. */
const LLM = {
  default: "claude",
  providers: [
    {
      id: "claude",
      label: "Claude Code",
      description: "Uses your Claude plan.",
      kind: "cli",
      defaultModel: "sonnet",
      models: ["sonnet"],
      ready: true,
    },
    {
      id: "opencode",
      label: "OpenCode",
      description: "Uses your OpenCode login.",
      kind: "cli",
      defaultModel: "opencode-go/glm-5.3-flash",
      models: ["opencode-go/glm-5.3-flash"],
      ready: true,
    },
    {
      id: "custom",
      label: "OpenAI-compatible",
      description: "Any server that speaks OpenAI's shape.",
      kind: "http",
      keyEnv: ["ANYDAG_LLM_API_KEY"],
      defaultModel: "qwen3",
      models: ["qwen3"],
      ready: false,
      reason: { code: "needs-base-url", provider: "custom", keyEnv: ["ANYDAG_LLM_API_KEY"] },
    },
  ],
};

const CHAT = {
  providers: [
    {
      provider: "claude",
      label: "Claude Code",
      available: true,
      default: "sonnet",
      models: [{ id: "sonnet", label: "Sonnet" }],
      efforts: ["", "low", "medium", "high", "max"],
    },
    {
      provider: "opencode",
      label: "OpenCode",
      available: true,
      default: "opencode-go/glm-5.3-flash",
      models: [{ id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash" }],
      efforts: ["", "low", "medium", "high", "max"],
    },
  ],
};

/** What each tab waits for before it is measured: the slow ones ask the server when they open. */
const READY: Record<SettingsTab, string> = {
  calendar: "[data-dag-setting-time-zone]",
  quizzes: "[data-dag-setting-graduate]",
  providers: "[data-dag-providers]",
  appearance: "[data-dag-setting-theme]",
  "vault-general": "[data-dag-setting-problems]",
  ai: '[data-dag-setting-ai-feature="diagrams"]',
  "vault-files": "[data-dag-setting-attachments]",
  export: "[data-dag-setting-export-scale]",
  sync: "[data-dag-sync-intro], [data-dag-sync-server-input], [data-dag-sync-state]",
  "agent-access": "[data-dag-setting-copy-value]",
  privacy: "[data-dag-setting-telemetry]",
  shortcuts: ".dag-shortcuts__grid",
  about: "[data-dag-setting-version]",
  "board-layout": "input[data-dag-board-flow-width]",
};

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-settings-phone-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
});

/**
 * Open the board and the sheet. A fake desktop bridge is installed so the AI providers tab draws
 * the key, address and model fields it draws in the app: that is the widest row the tab has, and a
 * browser alone would never show it. The two AI routes are answered here so the summary rows name a
 * provider and model rather than whatever this machine happens to have signed in.
 */
async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stored = new Set<string>();
    const env: Record<string, string> = {};
    (window as unknown as { anydagDesktop: unknown }).anydagDesktop = {
      keys: {
        set: async (key: string) => {
          stored.add(key);
          return true;
        },
        unset: async (key: string) => {
          stored.delete(key);
          return true;
        },
        names: async () => [...stored],
      },
      providerEnv: {
        get: async () => ({ ...env }),
        set: async (key: string, value: string) => {
          env[key] = value;
          return true;
        },
      },
    };
  });
  await page.route("**/__board/llm*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(LLM) }));
  await page.route("**/__board/chat/models*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(CHAT) }),
  );
  await page.goto(await vaulted(page, `/?board=${name}`));
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Open Settings on the tab list, as a phone does. */
async function openSheet(page: Page): Promise<void> {
  await page.keyboard.press("Control+Comma");
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  await expect(page.locator(".dag-settings-modal__nav")).toBeVisible();
}

/** The tabs this build draws, in the modal's own order. */
async function tabList(page: Page): Promise<SettingsTab[]> {
  return page
    .locator("[data-dag-settings-tab-button]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-dag-settings-tab-button") as SettingsTab));
}

/** Back to the tab list, where the next tab can be picked. */
async function backToTabs(page: Page): Promise<void> {
  await page.locator("[data-dag-settings-back]").click();
  await expect(page.locator(".dag-settings-modal__nav")).toBeVisible();
}

/** Move to a tab from the list, and wait for what that tab fetches when it opens. */
async function openTab(page: Page, tab: SettingsTab): Promise<void> {
  if (!(await page.locator(".dag-settings-modal__nav").isVisible())) await backToTabs(page);
  await settingsTab(page, tab);
  if (tab === "sync") {
    /* It says "Looking…" until the status route answers, and only then draws its form. */
    await page.waitForFunction(
      () => {
        const pane = document.querySelector('[data-dag-settings-pane="sync"]');
        return !!pane && !pane.querySelector("[data-dag-sync-loading]");
      },
      null,
      { timeout: 10_000 },
    );
    return;
  }
  if (tab === "providers") {
    /* The key row's field only appears once the fake shell says whether a key is stored. */
    await expect(
      page.locator('[data-dag-settings-pane="providers"] [data-dag-setting-key="ANYDAG_LLM_API_KEY"] input'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-dag-settings-pane="providers"] input[data-dag-provider-base-url]')).toBeVisible({
      timeout: 10_000,
    });
    return;
  }
  await expect(page.locator(`[data-dag-settings-pane="${tab}"] ${READY[tab]}`)).toBeVisible({ timeout: 10_000 });
}

interface Scan {
  count: number;
  small: string[];
}

/**
 * Every interactive element inside the Settings portal, and any whose own box is under 44 × 44.
 * A pseudo-element hit area would be invisible here — which is why the phone CSS moves a switch's
 * picture into its 44 × 44 input instead of extending the 32 × 18 box around it.
 */
function scan(page: Page): Promise<Scan> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-dag-settings]");
    if (!root) return { count: 0, small: ["[data-dag-settings] is not in the document"] };
    const nodes = root.querySelectorAll<HTMLElement>("button, input, select, textarea, summary, a[href]");
    const small: string[] = [];
    let count = 0;
    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
      if (Number(style.opacity) === 0) continue;
      if (el.getClientRects().length === 0) continue;
      count++;
      const box = el.getBoundingClientRect();
      if (box.width >= 44 && box.height >= 44) continue;
      const hook =
        el.getAttribute("data-dag-settings-tab-button") ??
        el.getAttribute("data-dag-setting-ai-feature") ??
        el.getAttribute("data-dag-setting-ai-back") ??
        el.getAttribute("data-dag-settings-back") ??
        el.getAttribute("data-dag-settings-close") ??
        el.getAttribute("data-dag-provider") ??
        el.getAttribute("aria-label") ??
        el.textContent?.trim().slice(0, 40) ??
        "";
      small.push(`${el.tagName.toLowerCase()} "${hook}" ${box.width.toFixed(1)}×${box.height.toFixed(1)}`);
    }
    return { count, small };
  });
}

/** No target in the sheet is under a finger, and the scan actually saw something. */
async function expectTargets(page: Page, where: string): Promise<void> {
  const got = await scan(page);
  expect(got.count, `${where}: interactive elements found`).toBeGreaterThan(0);
  expect(got.small, `${where}: targets under 44×44`).toEqual([]);
}

test("every target in Settings is at least 44 by 44 at phone width", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page);
  await openSheet(page);

  /* The list itself: every tab button, and the close button over the sheet. */
  await expectTargets(page, "tab list");

  for (const tab of await tabList(page)) {
    await openTab(page, tab);
    await expectTargets(page, tab);
    /* The AI tab's two feature pages are reached from its summary rows, and each has its own
       controls. The next check walks them and measures while they are open. */
    if (tab === "ai") {
      for (const feature of ["diagrams", "assistant"] as const) {
        await page.locator(`[data-dag-setting-ai-feature="${feature}"]`).click();
        await expectTargets(page, `ai · ${feature}`);
        await page.locator("[data-dag-setting-ai-back]").click();
      }
    }
    await backToTabs(page);
  }

  /* The reset's Undo lives inside the same portal, so it is a target too. */
  await openTab(page, "calendar");
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-reset-toast]")).toBeVisible();
  await expectTargets(page, "reset toast");
});

test("no tab scrolls sideways at phone width", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page);
  await openSheet(page);

  const widths = () =>
    page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>("[data-dag-settings-pane]")!;
      const doc = document.scrollingElement!;
      return {
        document: [doc.scrollWidth, doc.clientWidth],
        pane: [pane.scrollWidth, pane.clientWidth],
      };
    });

  for (const tab of await tabList(page)) {
    await openTab(page, tab);
    const got = await widths();
    expect(got.document[0], `${tab}: the page`).toBeLessThanOrEqual(got.document[1]!);
    expect(got.pane[0], `${tab}: its pane`).toBeLessThanOrEqual(got.pane[1]!);
    /* The two feature pages are part of the AI tab, and the model picker there is wider than the
       summary rows. */
    if (tab === "ai") {
      for (const feature of ["diagrams", "assistant"] as const) {
        await page.locator(`[data-dag-setting-ai-feature="${feature}"]`).click();
        const pageGot = await widths();
        expect(pageGot.document[0], `ai · ${feature}: the page`).toBeLessThanOrEqual(pageGot.document[1]!);
        expect(pageGot.pane[0], `ai · ${feature}: its pane`).toBeLessThanOrEqual(pageGot.pane[1]!);
        await page.locator("[data-dag-setting-ai-back]").click();
      }
    }
    await backToTabs(page);
  }
});

test("the AI tab is two summary rows that open their own page", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page);
  await openSheet(page);
  await openTab(page, "ai");

  const diagrams = page.locator('[data-dag-setting-ai-feature="diagrams"]');
  const assistant = page.locator('[data-dag-setting-ai-feature="assistant"]');
  await expect(diagrams).toBeVisible();
  await expect(assistant).toBeVisible();
  await expect(diagrams).toContainText("Diagrams and flashcards");
  await expect(diagrams).toContainText("Claude Code · sonnet");
  /* The provider's own mark, not a letter badge. */
  await expect(diagrams.locator("[data-dag-provider-mark]")).toHaveCount(1);
  await expect(assistant).toContainText("Assistant");
  await expect(assistant).toContainText("Claude Code · sonnet");
  await expect(assistant.locator("[data-dag-provider-mark]")).toHaveCount(1);

  /* The two groups' controls are behind their row, not under both of them. */
  await expect(page.locator("[data-dag-setting-llm-provider]")).toHaveCount(0);

  await diagrams.click();
  await expect(page.locator("[data-dag-setting-llm-provider]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-llm-model]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-llm-reasoning]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-assistant-provider]")).toHaveCount(0);
  /* The row that was pressed is gone; the focus is on the page's way back, still inside the modal. */
  await expect(page.locator("[data-dag-setting-ai-back]")).toBeFocused();

  /* Choosing an effort changes the summary's third word. */
  await page.locator("[data-dag-setting-llm-reasoning]").selectOption("low");
  await expect(page.locator("[data-dag-setting-ai-back]")).toBeVisible();
  await page.locator("[data-dag-setting-ai-back]").click();
  await expect(diagrams).toBeFocused();
  await expect(diagrams).toContainText("Claude Code · sonnet · Low");

  await assistant.click();
  await expect(page.locator("[data-dag-setting-assistant-provider]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-assistant-model]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-llm-provider]")).toHaveCount(0);
  await expect(page.locator("[data-dag-setting-ai-back]")).toBeFocused();
  await page.locator("[data-dag-setting-ai-back]").click();
  await expect(assistant).toBeFocused();

  /* The modal's own back still leaves the tab for the list. */
  await page.locator("[data-dag-settings-back]").click();
  await expect(page.locator(".dag-settings-modal__nav")).toBeVisible();
});

test("above 720px the AI tab is still the two groups", async ({ page }) => {
  await open(page);
  await openSheet(page);
  await settingsTab(page, "ai");

  await expect(page.locator("[data-dag-setting-llm-provider]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-ai-feature]")).toHaveCount(0);
  await expect(page.locator("[data-dag-setting-llm-model]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-llm-reasoning]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-assistant-provider]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-assistant-model]")).toBeVisible();
});
