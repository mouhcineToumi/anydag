import {
  ArrowLeft,
  Bot,
  Briefcase,
  CalendarDays,
  Keyboard,
  Info,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import type { BoardTree } from "@/board/useBoard";
import { useFeatures } from "@/features";
import { ShortcutList } from "@/edit/Shortcuts";
import { currentOf } from "@/vault/api";
import { useVaults } from "@/vault/useVaults";

import { AboutPane } from "./panes/About";
import { AgentsPane } from "./panes/Agents";
import { CalendarPane } from "./panes/Calendar";
import { ICON } from "./panes/common";
import { ExportPane } from "./panes/Export";
import { PreferencesPane } from "./panes/Preferences";
import { PrivacyPane } from "./panes/Privacy";
import { SyncPane } from "./panes/Sync";
import { VaultPane } from "./panes/Vault";
import { GROUPS, CLOUD_TABS, TABS, TAB_LABEL, lastTab, rememberTab, stepTab, withoutCloudTabs, type SettingsTab } from "./tabs";

const TAB_ICON: Record<SettingsTab, LucideIcon> = {
  calendar: CalendarDays,
  shortcuts: Keyboard,
  privacy: ShieldCheck,
  about: Info,
  preferences: SlidersHorizontal,
  vault: Briefcase,
  sync: RefreshCw,
  agents: Bot,
  export: PackageOpen,
};

/** Below this the modal is the whole window: a list of tabs, and one tab at a time. */
const NARROW = "(max-width: 719px)";

const narrow = (): boolean => {
  try {
    return matchMedia(NARROW).matches;
  } catch {
    return false;
  }
};

/** Whether Settings is up, and on which tab it was asked to open — the state each page keeps. */
export interface SettingsOpen {
  /** The tab a request named; absent is "where the last one left off". */
  tab?: SettingsTab;
}

/**
 * The state a page holds for the modal, and the three ways it is changed: a request that names a tab
 * (the switcher's *Vault settings…*, the account menu), `ctrl+,` which toggles it, and a close.
 * One hook for the three pages that draw it, so the rule is written once.
 */
export function useSettingsOpen() {
  const [open, setOpen] = useState<SettingsOpen | null>(null);
  const show = useCallback((tab?: SettingsTab) => setOpen({ tab }), []);
  const toggle = useCallback(() => setOpen((v) => (v ? null : {})), []);
  const close = useCallback(() => setOpen(null), []);
  return { open, show, toggle, close };
}

/**
 * What the *app* does, as opposed to what a board says — a modal with a tab for each topic, Notion's
 *.
 *
 * It replaced a single card that had grown a section per milestone until the theme, the export
 * scale, the model a prompt card asks and the quiz threshold were one scroll apart, with one line at
 * the top trying to say which of them were the account's and which the vault's. Now the split is
 * the tab list itself: *Account* for what is the person's, and the vault's own name for what
 * switches with it (`tabs.ts`). Every setting there was is in exactly one tab.
 *
 * Four things are load-bearing:
 *
 * - **It is over everything**, sidebar included, in a portal on `<body>` — it used to sit inside the
 *   page and leave the sidebar live beside it, so a click there did two things at once. The scrim
 *   dims what is behind it, and a press on it closes the modal.
 * - **It owns every key aimed at it.** `useEditor` counts a focused BUTTON, SELECT or INPUT as
 *   somebody typing and leaves them alone, and ignores anything inside `[data-dag-settings]`; the
 *   modal handles Escape and `ctrl+,` itself and stops every other key at its edge, so an arrow or a
 *   Delete pressed in here can never move or delete what is selected on the board behind it. Escape
 *   in a field that is holding a change takes the change back first; the next one closes.
 * - **There is no Save**, on any tab. Every control writes as it changes, which is what the rest of
 *   this app does with a file and the only behaviour that cannot leave a preference in a state
 *   nobody asked for. The vault's name, the one field that is text, saves when it is left.
 * - **The tab is remembered in this browser** (`dag:settings-tab`), and a request that names one
 *   opens on that one instead. On a narrow window a generic opening shows the list, as a phone's
 *   settings do, and a request for a tab goes straight to it.
 */
export function Settings({
  themes,
  themeName,
  onTheme,
  boardName,
  tab: asked,
  onClose,
}: {
  themes: string[];
  themeName: string;
  onTheme(name: string): void;
  /** Whose unused images the Vault tab offers to remove — never the whole vault's. */
  boardName: string | null;
  /** The listing the sidebar draws; the Vault tab no longer reads it. */
  list?: BoardTree;
  /** The tab a request named; otherwise the last one opened. */
  tab?: SettingsTab;
  onClose(): void;
}) {
  const [tab, setTabState] = useState<SettingsTab>(() => asked ?? lastTab());
  /* What the server says this build may show (`src/features.ts`): Privacy (only the logs hold it)
     and Sync are its tabs. A person reads no sign a server exists on a build without them — nor,
     while the answer is on its way, which is why the unknown hides them too. */
  const features = useFeatures();
  const cloud = features?.cloud === true;
  const groups = useMemo(() => withoutCloudTabs(GROUPS, cloud), [cloud]);
  const walked = useMemo(() => groups.flatMap((g) => g.tabs), [groups]);
  /* The tab as of the last key, not the last render: focus follows a step a frame later, so a
     second arrow pressed inside that frame still lands on the old button, and must step from the
     new tab rather than from the button it landed on. */
  const current = useRef(tab);
  const setTab = useCallback((t: SettingsTab) => {
    current.current = t;
    setTabState(t);
  }, []);
  /* A stored tab that is one of the gated ones moves to the first still drawn — once the server has
     said off, not while its answer is on its way, so a Sync tab asked for at boot is not lost. */
  const known = features !== null;
  useEffect(() => {
    if (known && !cloud && CLOUD_TABS.includes(tab)) setTab(TABS.find((t) => !CLOUD_TABS.includes(t)) ?? tab);
  }, [known, cloud, tab, setTab]);
  /* On a narrow window, the list or one tab; on a wide one both are drawn and this changes nothing. */
  const [view, setView] = useState<"list" | "pane">(() => (asked || !narrow() ? "pane" : "list"));
  const vault = currentOf(useVaults());
  const card = useRef<HTMLElement>(null);
  const id = useId();
  const tabId = (t: SettingsTab) => `${id}-tab-${t}`;
  const paneId = `${id}-pane`;

  /* Whichever way a tab came to be open — asked for, clicked, arrowed to — it is the one to come back to. */
  useEffect(() => rememberTab(tab), [tab]);

  /* The focus starts on the tab that is open, which is also where the arrow keys start from — or,
     on a narrow window showing one tab, on the way back to the list. */
  useEffect(() => {
    const at = card.current?.querySelector<HTMLElement>(
      view === "list" || !narrow() ? `#${CSS.escape(tabId(tab))}` : "[data-dag-settings-back]",
    );
    (at ?? card.current)?.focus();
    /* Once, on open: after that the focus is the person's. */
  }, []);

  const focusTab = (t: SettingsTab) => requestAnimationFrame(() => document.getElementById(tabId(t))?.focus());

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const next = stepTab(current.current, e.key, walked);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    focusTab(next);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    /* A portal inside a tab (the vault's delete question) bubbles here through React but is not
       in this element: its keys are its own. */
    if (!card.current?.contains(e.target as Node)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (mod && !e.altKey && e.key === ",") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") trap(e);
    /* Every other key stops here, so none reaches the page behind the modal: see the note above. */
    e.stopPropagation();
  };

  /** Tab and shift+Tab go round the modal and never leave it — it is modal, so there is nowhere else. */
  const trap = (e: ReactKeyboardEvent<HTMLElement>) => {
    const all = Array.from(
      card.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
    if (all.length === 0) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !all.includes(at as HTMLElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !all.includes(at as HTMLElement))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="dag-settings-modal__scrim" data-dag-settings="" onPointerDown={onClose}>
      <section
        ref={card}
        tabIndex={-1}
        className="dag-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-dag-settings-view={view}
        data-dag-settings-tab={tab}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <nav className="dag-settings-modal__nav" aria-label="Settings">
          <h2 className="dag-settings-modal__title">Settings</h2>
          {groups.map((g) => {
            const heading = `${id}-group-${g.group}`;
            return (
              <div key={g.group} className="dag-settings-modal__group">
                <p
                  id={heading}
                  className="dag-settings-modal__heading"
                  data-dag-settings-group={g.group}
                  /* Which vault the second group's tabs are kept with: its name is the heading. */
                  {...(g.group === "vault" ? { "data-dag-settings-vault": vault.id } : {})}
                >
                  {g.group === "account" ? "App" : vault.name}
                </p>
                <div role="tablist" aria-orientation="vertical" aria-labelledby={heading}>
                  {g.tabs.map((t) => {
                    const TabIcon = TAB_ICON[t];
                    const on = t === tab;
                    return (
                      <button
                        key={t}
                        id={tabId(t)}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        aria-controls={paneId}
                        tabIndex={on ? 0 : -1}
                        className="dag-settings-modal__tab"
                        data-dag-settings-tab-button={t}
                        onClick={() => {
                          setTab(t);
                          setView("pane");
                          /* On a narrow window the list goes away under the click, and the focus with it. */
                          if (narrow())
                            requestAnimationFrame(() =>
                              card.current?.querySelector<HTMLElement>("[data-dag-settings-back]")?.focus(),
                            );
                        }}
                        onKeyDown={onTabKey}
                      >
                        <TabIcon {...ICON} aria-hidden="true" />
                        <span>{TAB_LABEL[t]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div
          id={paneId}
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          className="dag-settings-modal__pane"
          data-dag-settings-pane={tab}
        >
          <header className="dag-settings-modal__head">
            <button
              type="button"
              className="dag-icon dag-settings-modal__back"
              aria-label="All settings"
              data-dag-settings-back=""
              onClick={() => {
                setView("list");
                focusTab(tab);
              }}
            >
              <ArrowLeft {...ICON} aria-hidden="true" />
            </button>
            <h3>{TAB_LABEL[tab]}</h3>
          </header>
          <div className="dag-settings-modal__body">
            {tab === "calendar" ? (
              <CalendarPane />
            ) : tab === "shortcuts" ? (
              <ShortcutList />
            ) : tab === "privacy" && cloud ? (
              <PrivacyPane />
            ) : tab === "about" ? (
              <AboutPane
                onShortcuts={() => {
                  setTab("shortcuts");
                  focusTab("shortcuts");
                }}
              />
            ) : tab === "preferences" ? (
              <PreferencesPane themes={themes} themeName={themeName} onTheme={onTheme} />
            ) : tab === "vault" ? (
              <VaultPane boardName={boardName} />
            ) : tab === "sync" && cloud ? (
              <SyncPane />
            ) : tab === "agents" ? (
              <AgentsPane />
            ) : (
              <ExportPane />
            )}
          </div>
        </div>

        <button
          type="button"
          className="dag-icon dag-settings-modal__close"
          aria-label="Close settings"
          data-dag-settings-close=""
          onClick={onClose}
        >
          <X {...ICON} aria-hidden="true" />
        </button>
      </section>
    </div>,
    document.body,
  );
}
