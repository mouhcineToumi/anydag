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
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { FileIcon as AttachmentIcon } from "@/files/FileIcon";
import { IconButton } from "@/ui/controls";
import { useSidebar } from "@/ui/Shell";

import { middle } from "./intent";
import { fileOf, kindOf, tabLabel, type Tab, type TabKind, type Tabs } from "./model";

const SMALL = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Each kind of tab's mark — the sidebar's, so a tab and the row it came from wear the same one. */
const KIND_ICON = {
  board: Workflow,
  note: FileText,
  quiz: GraduationCap,
  table: Table2,
  tasks: ListTodo,
  calendar: CalendarDays,
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
export function DocTabs({ tabs, active, titles, onSwitch, onClose, onNew }: Props) {
  const sidebar = useSidebar();
  const scroll = useRef<HTMLDivElement>(null);

  /* The tab in front stays in view: the strip scrolls rather than squeezing its tabs. */
  useEffect(() => {
    scroll.current
      ?.querySelector<HTMLElement>(`[data-dag-doctab="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.list.length]);

  if (tabs.list.length < 2) return null;

  /* Plain arrows rove the tablist, as the page strip's do: the WAI pattern. */
  const onKeyDown = (at: number) => (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = tabs.list[at + dir];
    if (next) scroll.current?.querySelector<HTMLElement>(`[data-dag-doctab="${CSS.escape(next.id)}"]`)?.focus();
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
                onClick={() => onSwitch(tab.id)}
                /* A middle click closes, as it does in a browser. */
                onAuxClick={middle(() => onClose(tab.id))}
                onKeyDown={onKeyDown(at)}
              >
                <TabMark place={tab.place} />
                <span className="dag-doctabs__label">{label}</span>
              </button>
              <button
                type="button"
                className="dag-doctabs__close"
                data-dag-doctab-close={tab.id}
                aria-label={`Close ${label}`}
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
    </nav>
  );
}
