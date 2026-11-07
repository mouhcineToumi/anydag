import { useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowBigRight,
  BarChart3,
  Box,
  Cylinder,
  Diamond,
  Egg,
  Hexagon,
  MessageCircle,
  Octagon,
  Pentagon,
  Pill,
  Shapes,
  Star,
  Triangle,
  Boxes,
  Braces,
  Brain,
  CalendarRange,
  ChevronRight,
  Circle,
  CircleDot,
  Cloud,
  Container,
  Database,
  Donut,
  Dot,
  FileText,
  GraduationCap,
  Flag,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Globe,
  Group,
  Heading1,
  Image,
  KeyRound,
  Layers,
  LayoutTemplate,
  LineChart,
  ListChecks,
  ListTree,
  Merge,
  MessagesSquare,
  Milestone,
  Monitor,
  MoveRight,
  Package,
  PieChart,
  Quote,
  Radio,
  RectangleHorizontal,
  Repeat,
  Route,
  Rows3,
  Minus,
  Search,
  Server,
  Smartphone,
  Split,
  Square,
  SquareCheckBig,
  Sparkles,
  StickyNote,
  Table,
  Table2,
  TextCursorInput,
  Type,
  UserRound,
  Users,
  Workflow,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

import { BROWSABLE, CATEGORIES, categoryOf, isFragment, madeOf, matches, noteCard, SHELVES, type Component } from "@/board/library";
import { isItemType, itemName } from "@/board/types";
import type { Theme } from "@/theme/contract";
import { Icon, iconFor } from "@/render/Icon";
import { useIndex } from "@/refs/useIndex";
import { DRAG_SLOP } from "@/canvas/geometry";

import { Parallelogram, Trapezoid } from "./glyphs";
import { useAppliedTheme } from "./IconPicker";
import type { Editor } from "./useEditor";

/**
 * The library: ready-made components down the right, to click or to drag onto the board.
 *
 * A click puts the component in the middle of the view; a drag puts it where the pointer lets go.
 * A *part* — a fragment of one dialect — dropped onto a diagram of its type is appended to that
 * diagram's source, which is the one thing here that is not "make a new item": it is how a person
 * adds a service to an architecture without writing the line.
 *
 * The drag is pointer events, not HTML drag-and-drop: the canvas already sets `touch-action: none`
 * and listens for pointers, and the native API would hand it a `dragover` storm and a ghost image
 * it cannot style. The ghost here is a painted chip that follows the pointer, and the drop target
 * under it is marked with a painted attribute — neither reaches React until the drop.
 *
 * Icons are named in the data and resolved here, from an explicit map rather than the whole of
 * Lucide: importing the namespace would put twelve hundred glyphs in the bundle for thirty.
 */
const ICONS: Record<string, LucideIcon | ComponentType<LucideProps>> = {
  BarChart3, Box, Boxes, Braces, Brain, CalendarRange, Circle, CircleDot, Cloud, Container, Database,
  Donut, Dot, FileText, Flag, GraduationCap, GitBranch, GitCommitHorizontal, GitFork, Globe, Group, Heading1, Image,
  KeyRound, Layers, LayoutTemplate, LineChart, ListChecks, ListTree, Merge, MessagesSquare, Milestone,
  Monitor, MoveRight, Minus, Package, PieChart, Quote, Radio, RectangleHorizontal, Repeat, Route,
  Rows3, Server, Smartphone, Sparkles, Split, Square, SquareCheckBig, StickyNote, Table, Table2, TextCursorInput, Type, UserRound,
  Users, Workflow,
  /* The geometric shapes. */
  ArrowBigRight, Cylinder, Diamond, Egg, Hexagon, MessageCircle, Octagon, Pentagon, Pill, Shapes, Star,
  Triangle, Parallelogram, Trapezoid,
};

/** Lucide at one size and weight, stated once. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * One row: the glyph, the name, what it is for.
 *
 * An **inner** atom — a port row, a class member — is a row that cannot be dropped anywhere,
 * because it is grammatical only inside the braces of the thing above it. It appears here so a
 * person expanding "Service with ports" can see what a service with ports is made of, and it is
 * deliberately not a button: there is nothing to click.
 */
/**
 * A blueprint's description starts with its dialect ("sketch · a plain rectangle.") so a listing
 * read without its sections still says what grammar each part is; on the panel the section already
 * says it, so the prefix goes and the sentence starts with a capital.
 */
function plainDescription(d: string): string {
  const m = /^([a-z0-9]+) · (.*)$/s.exec(d);
  if (!m || !isItemType(m[1]!)) return d;
  return m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1);
}

function entry(c: Component, press: (c: Component) => (e: ReactPointerEvent<HTMLButtonElement>) => void) {
  const Glyph = ICONS[c.icon] ?? Box;
  const inside = (
    <>
      <span className="dag-component__icon">
        <Glyph {...ICON} aria-hidden="true" />
      </span>
      <span className="dag-component__text">
        <span className="dag-component__name">{isItemType(c.name) ? itemName(c.name) : c.name}</span>
        <span className="dag-component__desc">{plainDescription(c.description)}</span>
      </span>
    </>
  );
  if (c.inner)
    return (
      <span key={c.id} className="dag-component dag-component--inner" data-dag-component={c.id} title="Only inside the thing above it">
        {inside}
      </span>
    );
  return (
    <button
      key={c.id}
      type="button"
      className="dag-component"
      data-dag-component={c.id}
      title={isFragment(c) ? `Drag onto a ${c.type} diagram, or click to start one` : "Click to add, or drag onto the board"}
      onPointerDown={press(c)}
    >
      {inside}
    </button>
  );
}

/**
 * One picture on an Objects shelf: the picture itself, with its name under it.
 *
 * A tile rather than a row because the picture *is* the entry — a row of fifteen hundred Lucide
 * `Image` glyphs beside the words "Man technologist" would be the bare-text icon field this
 * library's picker already replaced. It is drawn by the card's own resolver and `Icon`, so what the
 * tile shows is what lands; an emoji's art is fetched the first time a tile needs it.
 */
function tile(c: Component, press: (c: Component) => (e: ReactPointerEvent<HTMLButtonElement>) => void, theme: Theme) {
  const icon = iconFor("figure", theme, c.picture || undefined);
  return (
    <button
      key={c.id}
      type="button"
      className="dag-object"
      data-dag-component={c.id}
      aria-label={c.name}
      title={`${c.name} — click to add, or drag onto the board`}
      onPointerDown={press(c)}
    >
      <span className="dag-object__pic" data-dag-object-art={icon.mode}>
        <Icon icon={icon} size={30} stroke={1.75} />
      </span>
      <span className="dag-object__name">{c.name}</span>
    </button>
  );
}

/**
 * A shape on the Shapes shelf: its outline, with its name under it — the picture is what tells a
 * hexagon from an octagon, and a sentence about each was the list reading itself aloud. The
 * sentence is still the tooltip.
 */
function shapeTile(c: Component, press: (c: Component) => (e: ReactPointerEvent<HTMLButtonElement>) => void) {
  const Glyph = ICONS[c.icon] ?? Box;
  return (
    <button
      key={c.id}
      type="button"
      className="dag-object"
      data-dag-component={c.id}
      aria-label={c.name}
      title={`${plainDescription(c.description)} Click to add, or drag onto the board.`}
      onPointerDown={press(c)}
    >
      <span className="dag-object__pic">
        <Glyph size={24} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
      </span>
      <span className="dag-object__name">{c.name}</span>
    </button>
  );
}

/**
 * How many tiles a shelf shows before "Show all": enough to see what it holds, few enough that the
 * panel opens on something other than fifteen hundred pictures. The two picked shelves show more,
 * and a search shows more again, because by then the list is short for a reason.
 */
const shelfCap = (shelf: string, query: boolean): number =>
  query ? 48 : shelf === "Drawn" || shelf === "Essentials" ? 16 : 8;

/** The diagram item under a client point, if any. */
const itemAt = (x: number, y: number): HTMLElement | null =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-dag-item]") ?? null;

export function Library({ editor, saved, onClose }: { editor: Editor; saved: Component[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  /* Which Objects shelves are showing everything. Plain state, like `open`: how far somebody
     scrolled into the emoji is not a preference worth a key. */
  const [shelvesOpen, setShelvesOpen] = useState<Set<string>>(() => new Set());
  const ghost = useRef<HTMLDivElement>(null);
  const theme = useAppliedTheme();

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /* The account's notes, as cards to place. Read here rather than in `App`, so the index
     refreshing re-renders an open library and never the canvas. */
  const docs = useIndex().docs;
  const all = useMemo(
    () => [...saved, ...docs.filter((d) => d.kind === "note" || d.kind === "quiz" || d.kind === "table").map(noteCard), ...BROWSABLE],
    [saved, docs],
  );

  const shown = useMemo(() => {
    const q = query.trim();
    return CATEGORIES.map((category) => ({
      category,
      items: all.filter((c) => categoryOf(c) === category && (!q || matches(c, q))),
    })).filter((g) => g.items.length > 0);
  }, [all, query]);

  /* What each entry is composed of, deduped and computed once: the panel is where the layers stop
     being an implementation detail and become something a person can reach into. */
  const made = useMemo(() => {
    const out = new Map<string, Component[]>();
    for (const c of all) {
      const seen = new Set<string>();
      const parts = madeOf(c).filter((p) => !seen.has(p.id) && seen.add(p.id));
      if (parts.length) out.set(c.id, parts);
    }
    return out;
  }, [all]);

  const onPointerDown = (component: Component) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let target: HTMLElement | null = null;

    const mark = (el: HTMLElement | null) => {
      if (el === target) return;
      if (target) delete target.dataset.dagDrop;
      target = el;
      if (target) target.dataset.dagDrop = "";
    };

    const onMove = (ev: PointerEvent) => {
      const g = ghost.current;
      if (!moved) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_SLOP) return;
        moved = true;
        if (g) {
          g.textContent = component.name;
          g.hidden = false;
        }
        document.documentElement.dataset.dagDragging = "";
      }
      if (g) g.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
      /* Only a part has a drop target other than the paper, and only a diagram of its own type. */
      const over = isFragment(component) ? itemAt(ev.clientX, ev.clientY) : null;
      mark(over && over.dataset.dagType === component.type ? over : null);
    };

    const onUp = (ev: PointerEvent) => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      const g = ghost.current;
      if (g) g.hidden = true;
      delete document.documentElement.dataset.dagDragging;
      const dropped = target;
      mark(null);

      if (!moved) {
        /* A click: the middle of the view. */
        editor.place(component);
        return;
      }
      if (ev.type !== "pointerup") return;
      if (dropped && editor.dropPart(component, dropped.dataset.dagItem ?? "")) return;
      const view = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".dag-viewport");
      if (!view) return;
      editor.place(component, editor.toBoard(ev.clientX, ev.clientY));
    };

    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  };

  return (
    <aside className="dag-library" data-dag-library="" aria-label="Component library">
      <header className="dag-panel__search">
        <Search {...ICON} aria-hidden="true" />
        <input
          className="dag-panel__input"
          data-dag-library-search=""
          placeholder="Find a component or a picture"
          aria-label="Find a component or a picture"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (query ? setQuery("") : onClose())}
        />
        <button type="button" className="dag-panel__clear" aria-label="Close the library (L)" onClick={onClose}>
          <X {...ICON} aria-hidden="true" />
        </button>
      </header>

      <div className="dag-library__list">
        {shown.length === 0 ? <p className="dag-panel__empty">Nothing matches.</p> : null}
        {shown.map(({ category, items }) =>
          category === "Objects" ? (
            <section key={category} className="dag-panel__group" data-dag-objects="">
              <h3 className="dag-panel__folder">{category}</h3>
              {/* Searching, the shelves are one grid in shelf order: four hits on four shelves were
                  four headings and four mostly empty rows, and which shelf a truck is on is not what
                  somebody who typed "truck" is asking. Browsing, each shelf is its own. */}
              {(query.trim() ? (["Results"] as const) : SHELVES).map((shelf) => {
                const on =
                  shelf === "Results"
                    ? SHELVES.flatMap((s) => items.filter((c) => c.shelf === s))
                    : items.filter((c) => c.shelf === shelf);
                if (on.length === 0) return null;
                const all = shelvesOpen.has(shelf);
                const cap = all ? on.length : shelfCap(shelf, query.trim() !== "");
                return (
                  <div key={shelf} className="dag-shelf" data-dag-shelf={shelf}>
                    <p className="dag-shelf__head">
                      <span>{shelf}</span>
                      <span className="dag-shelf__count">{on.length}</span>
                    </p>
                    <div className="dag-shelf__grid">{on.slice(0, cap).map((c) => tile(c, onPointerDown, theme))}</div>
                    {on.length > cap || all ? (
                      <button
                        type="button"
                        className="dag-shelf__more"
                        data-dag-shelf-more={shelf}
                        aria-expanded={all}
                        onClick={() =>
                          setShelvesOpen((prev) => {
                            const next = new Set(prev);
                            if (!next.delete(shelf)) next.add(shelf);
                            return next;
                          })
                        }
                      >
                        {all ? "Show fewer" : `Show all ${on.length}`}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : (
          <section key={category} className="dag-panel__group">
            <h3 className="dag-panel__folder">{category}</h3>
            {category === "Shapes" && items.some((c) => !made.has(c.id)) ? (
              <div className="dag-shelf__grid dag-shapes__grid" data-dag-shapes="">
                {items.filter((c) => !made.has(c.id)).map((c) => shapeTile(c, onPointerDown))}
              </div>
            ) : null}
            {(category === "Shapes" ? items.filter((c) => made.has(c.id)) : items).map((c) => {
              const parts = made.get(c.id) ?? [];
              return (
                <div key={c.id} className="dag-component__block">
                  <div className="dag-component__row">
                    {entry(c, onPointerDown)}
                    {parts.length > 0 ? (
                      <button
                        type="button"
                        className="dag-component__toggle"
                        data-dag-expand={c.id}
                        aria-expanded={open.has(c.id)}
                        aria-label={`What ${c.name} is made of`}
                        title={`What ${c.name} is made of`}
                        onClick={() => toggle(c.id)}
                      >
                        <ChevronRight {...ICON} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {open.has(c.id) ? (
                    <div className="dag-component__parts" data-dag-parts={c.id}>
                      {parts.map((p) => entry(p, onPointerDown))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
          ),
        )}
      </div>

      <p className="dag-panel__count">Click to add, or drag onto the board</p>
      <div ref={ghost} className="dag-ghost" hidden aria-hidden="true" />
    </aside>
  );
}
