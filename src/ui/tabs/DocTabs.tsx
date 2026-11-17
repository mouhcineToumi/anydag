import {
  CalendarDays,
  FileText,
  GraduationCap,
  Home,
  ListTodo,
  Plus,
  Sparkles,
  Table2,
  Trash2,
  Waypoints,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Spot } from "@/calendar/menu";
import { FileIcon as AttachmentIcon } from "@/files/FileIcon";
import { IconButton } from "@/ui/controls";
import { startDrag } from "@/ui/pointerDrag";
import { useSidebar } from "@/ui/Shell";
import { TasksMenu } from "@/ui/TasksMenu";

import { middle } from "./intent";
import { fileOf, kindOf, tabLabel, type Tab, type TabKind, type Tabs } from "./model";

/* The chords, as the menu names them — Ctrl, or ⌘ on a Mac (`keys.ts`). */
const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");
const SHORT = { close: MAC ? "⌘W" : "Ctrl+W", reopen: MAC ? "⇧⌘T" : "Ctrl+Shift+T" };

const SMALL = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Each kind of tab's mark — the sidebar's, so a tab and the row it came from wear the same one. */
const KIND_ICON = {
  board: Workflow,
  note: FileText,
  quiz: GraduationCap,
  table: Table2,
  tasks: ListTodo,
  calendar: CalendarDays,
  graph: Waypoints,
  quizzes: GraduationCap,
  trash: Trash2,
  assistant: Sparkles,
  home: Home,
} satisfies Record<Exclude<TabKind, "file">, LucideIcon>;

function TabMark({ place }: { place: string }) {
  const kind = kindOf(place);
  if (kind === "file") return <AttachmentIcon name={fileOf(place)?.name ?? ""} {...SMALL} />;
  const Icon = KIND_ICON[kind];
  return <Icon {...SMALL} aria-hidden="true" />;
}

interface Props {
  tabs: Tabs;
  /** The tab in front: the address's, which may be a render ahead of `tabs.active`. */
  active: string;
  titles: Readonly<Record<string, string>>;
  onSwitch(id: string): void;
  onClose(id: string): void;
  /** Close every tab but this one. */
  onCloseOthers(id: string): void;
  /** Open the last tab closed again. */
  onReopen(): void;
  /** Put a tab at this position in the strip. */
  onMove(id: string, to: number): void;
  onNew(): void;
}

/**
 * The document tabs, across the top of the page — the window's documents, as a browser's tabs are.
 *
 * **Not the page tabs.** A board's pages are `PageBar` along the bottom, and they own `dag-tab*` and
 * `data-dag-page*`; these are `dag-doctabs*` and `data-dag-doctab*`, grepped first.
 *
 * **Drawn from two tabs.** One tab says nothing a sidebar row does not and would cost a row on every
 * page, which is the page strip's own reason for hiding with one page; a middle click, Ctrl/⌘ and a
 * click on what opens a file, or a row's *Open in a new tab*, makes the second.
 */
export function DocTabs({ tabs, active, titles, onSwitch, onClose, onCloseOthers, onReopen, onMove, onNew }: Props) {
  const sidebar = useSidebar();
  const scroll = useRef<HTMLDivElement>(null);
  /* The tab whose menu is open, and where. */
  const [menu, setMenu] = useState<{ id: string; at: Spot; from: HTMLElement } | null>(null);
  /* Whether the press that is ending was a drag, so its click does not also switch (`PageBar`). */
  const dragged = useRef(false);

  /* The tab in front stays in view: the strip scrolls rather than squeezing its tabs. */
  useEffect(() => {
    scroll.current
      ?.querySelector<HTMLElement>(`[data-dag-doctab="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.list.length]);

  if (tabs.list.length < 2) return null;

  const focusTab = (id: string) => scroll.current?.querySelector<HTMLElement>(`[data-dag-doctab="${CSS.escape(id)}"]`)?.focus();

  /* Plain arrows rove the tablist, as the page strip's do: the WAI pattern. Shift and an arrow move
     the tab, which is the reorder without a pointer; Shift+F10 or the menu key opens its menu. */
  const onKeyDown = (id: string, at: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ id, at: { x: r.left, y: r.bottom }, from: e.currentTarget });
      return;
    }
    /* Delete closes the focused tab, the WAI pattern's key for a tab that can be closed; the focus
       goes to the tab that takes its place. */
    if (e.key === "Delete" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      /* Not the board's Delete as well, which would take its selection with it. */
      e.preventDefault();
      e.stopPropagation();
      const after = tabs.list[at + 1] ?? tabs.list[at - 1];
      onClose(id);
      if (after) requestAnimationFrame(() => focusTab(after.id));
      return;
    }
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (e.shiftKey) {
      onMove(id, at + dir);
      /* The same button, moved: it keeps the focus, which a drawn-again strip would lose. */
      requestAnimationFrame(() => focusTab(id));
      return;
    }
    const next = tabs.list[at + dir];
    if (next) focusTab(next.id);
  };

  const clearMarks = () => {
    for (const el of scroll.current?.querySelectorAll<HTMLElement>("[data-dag-doctab-drop]") ?? [])
      delete el.dataset.dagDoctabDrop;
  };

  /* A drag along the strip puts the tab where it is let go: the `PageBar` gesture, whose notes hold. */
  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    const wrap = e.currentTarget.closest<HTMLElement>(".dag-doctabs__wrap");
    const startX = e.clientX;
    let to = -1;
    startDrag(e, {
      onMove(ev, first) {
        if (first) wrap?.classList.add("dag-doctabs__wrap--dragging");
        if (wrap) wrap.style.transform = `translateX(${ev.clientX - startX}px)`;
        clearMarks();
        to = -1;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".dag-doctabs__wrap");
        const target = over?.querySelector<HTMLElement>("[data-dag-doctab]")?.dataset.dagDoctab;
        if (!over || !target || target === id) return;
        const box = over.getBoundingClientRect();
        const after = ev.clientX > box.x + box.width / 2;
        over.dataset.dagDoctabDrop = after ? "after" : "before";
        const from = tabs.list.findIndex((t) => t.id === id);
        const at = tabs.list.findIndex((t) => t.id === target);
        /* Its place once it has left its own: past it, one fewer to its left. */
        to = (after ? at + 1 : at) - (from < at ? 1 : 0);
      },
      onDrop() {
        if (to < 0) return;
        dragged.current = true;
        onMove(id, to);
      },
      onEnd() {
        clearMarks();
        wrap?.classList.remove("dag-doctabs__wrap--dragging");
        if (wrap) wrap.style.transform = "";
      },
    });
  };

  const away = sidebar ? !sidebar.docked : false;
  return (
    <nav className="dag-doctabs" data-dag-doctabs="" data-dag-doctabs-edge={away ? "" : undefined} aria-label="Open documents">
      {/* The sidebar's toggle is drawn over the window's top-left corner; while the column is away
          the strip is that corner, and keeps the toggle's place as the toolbar does. */}
      {away ? <span className="dag-sidebar-toggle-slot" aria-hidden="true" /> : null}
      <div className="dag-doctabs__scroll" ref={scroll} role="tablist" aria-label="Open documents">
        {tabs.list.map((tab: Tab, at) => {
          const on = tab.id === active;
          const label = tabLabel(tab.place, titles);
          return (
            <span key={tab.id} className={on ? "dag-doctabs__wrap dag-doctabs__wrap--on" : "dag-doctabs__wrap"}>
              <button
                type="button"
                role="tab"
                className="dag-doctabs__tab"
                data-dag-doctab={tab.id}
                data-dag-doctab-kind={kindOf(tab.place)}
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                title={label}
                onPointerDown={onPointerDown(tab.id)}
                onClick={() => {
                  if (!dragged.current) onSwitch(tab.id);
                }}
                /* A middle click closes, as it does in a browser. */
                onAuxClick={middle(() => onClose(tab.id))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: tab.id, at: { x: e.clientX, y: e.clientY }, from: e.currentTarget });
                }}
                onKeyDown={onKeyDown(tab.id, at)}
              >
                <TabMark place={tab.place} />
                <span className="dag-doctabs__label">{label}</span>
              </button>
              {/* The pointer's way to close. A tablist may hold only tabs, so it is out of the
                  accessibility tree and out of the Tab order: from the keyboard, Delete on the tab,
                  Ctrl/⌘+W, or the tab's menu close it. */}
              <button
                type="button"
                className="dag-doctabs__close"
                data-dag-doctab-close={tab.id}
                aria-hidden="true"
                title={`Close ${label}`}
                tabIndex={-1}
                onClick={() => onClose(tab.id)}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
      <IconButton className="dag-doctabs__new" data-dag-doctab-new="" aria-label="New tab" onClick={onNew}>
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
      {menu ? (
        <TasksMenu
          at={menu.at}
          label="Tab"
          data={{ "data-dag-doctab-menu": menu.id }}
          onClose={() => {
            const back = menu.from;
            setMenu(null);
            if (back.isConnected) back.focus();
          }}
          rows={[
            {
              key: "close",
              label: "Close",
              hint: SHORT.close,
              data: { "data-dag-doctab-menu-item": "close" },
              onPick: () => onClose(menu.id),
            },
            {
              key: "others",
              label: "Close others",
              disabled: tabs.list.length < 2,
              data: { "data-dag-doctab-menu-item": "others" },
              onPick: () => onCloseOthers(menu.id),
            },
            { kind: "rule", key: "rule" },
            {
              key: "reopen",
              label: "Reopen closed tab",
              hint: SHORT.reopen,
              disabled: tabs.closed.length === 0,
              data: { "data-dag-doctab-menu-item": "reopen" },
              onPick: onReopen,
            },
          ]}
        />
      ) : null}
    </nav>
  );
}
