import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { BookOpen, Wand2, X } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";

import { CodePre } from "@/render/CodeBlock";
import { INSPECTOR_WIDTH, readPref, writePref } from "@/settings/prefs";
import type { BoardLink } from "@/board/types";
import { isDiagramType, isLinkType, itemName, type BoardItem, type BoardPage, type ItemType } from "@/board/types";
import { declaredAt, declaredOn } from "@/dsl/declared";
import { removeEdge } from "@/dsl/restate";
import { fromMermaid } from "@/dsl/from-mermaid";
import { detectMermaid } from "@/dsl/mermaid";

import { RepairBox } from "@/ui/Problems";
import type { Problem } from "@/ui/problemList";

import { segOf } from "./pick";
import type { Fix, Repair } from "./repair";
import { linkEndChoices } from "./linkEnds";
import { Props, type Subject } from "./Props";
import type { Editor } from "./useEditor";

/** Lucide at one size and weight, stated once. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** How long after the last keystroke the file is written. */
const DEBOUNCE = 250;

/* The cheat sheet's examples are what people copy from. One object for the module's life:
   to React a component in it is a type, and a new one every render would remount every block. */
const SHEET: Components = { pre: CodePre };

/** The range a drag may put the panel's width in; where it is kept is `settings/prefs.ts`. */
const MIN_W = 280;
const MAX_W = 900;
const DEFAULT_W = 400;

function storedWidth(): number {
  const n = Number(readPref(INSPECTOR_WIDTH));
  return Number.isFinite(n) && n >= MIN_W && n <= MAX_W ? n : DEFAULT_W;
}

/**
 * The panel for one item: its problems, its controls, and the few things its fence line says about it.
 *
 * **Controls, not text** (#145). A diagram's body is a language, and everything it says has a
 * control — the item's own fields, and the strip for whatever is picked inside it — so the panel
 * holds those and the canvas is the rest. There was a *Source* tab beside them, remembered as a
 * preference; it is gone, not hidden behind a setting (decided on #132). An agent still writes the
 * DSL, and a person never has to read it.
 *
 * Every control hands the whole body back through `onChange`, and the body goes to the file a
 * quarter of a second after the last change; the watcher and the parser do the rest, through the
 * same path an agent's writes take. The draft is the one thing that is not the file: an outside
 * change to the item wins only when nothing is pending; otherwise the draft stands and the next
 * write carries it. The text box is left only for what is not a language — an image's caption and
 * a prompt card's request.
 */
export function Inspector({
  item,
  editor,
  boardName,
  pages,
  boardLinks,
  boardItems,
  problems = [],
  repairOf,
  onRepair,
}: {
  item: BoardItem;
  editor: Editor;
  boardName: string;
  pages: BoardPage[];
  /** Every link on the board, so a picked one can be edited where its statement lives. */
  boardLinks: readonly BoardLink[];
  /** Every item on the board: what a picked link's ends may be moved onto. */
  boardItems: readonly BoardItem[];
  /**
   * What is wrong with this item, lines counted in the board file. The panel is where they belong
   * while somebody is typing: the dock stays quiet about the item that is open here.
   */
  problems?: readonly Problem[];
  /** A board setting's repair, as the dock offers it; absent when the board cannot be written. */
  repairOf?(p: Problem): Repair | null;
  onRepair?(fix: Fix): Promise<string | null>;
}) {
  const [draft, setDraft] = useState(item.body);
  const [width, setWidth] = useState(storedWidth);
  const [sheet, setSheet] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  /* What the box holds right now, for a rename that has to put it back if refused. */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** The body this panel last wrote (or started from), to tell its own echo from a real change. */
  const sent = useRef(item.body);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ id: string; body: string } | null>(null);
  const { setBody } = editor;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) {
      sent.current = p.body;
      setBody(p.id, p.body);
    }
  }, [setBody]);

  /* A different item: write what was pending for the last one, then start from this one. */
  useEffect(() => {
    flush();
    setDraft(item.body);
    sent.current = item.body;
    setShowSheet(false);
    area.current?.focus();
    /* `item.id` is the trigger; `item.body` is read on purpose only when the id changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, flush]);

  /* The same item, changed from outside — and not by this panel's own write coming back. */
  useEffect(() => {
    if (item.body === sent.current || pending.current) return;
    sent.current = item.body;
    setDraft(item.body);
  }, [item.body]);

  useEffect(() => () => flush(), [flush]);

  const onChange = (body: string) => {
    setDraft(body);
    pending.current = { id: item.id, body };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE);
  };

  /**
   * A node of this item renamed: the new body and the board's links to the old name, one write.
   * The draft stands in at once (the pick is re-pointed against it); a refusal puts it back.
   */
  const onRenameNode = (next: string, from: string, to: string) => {
    const before = draftRef.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    sent.current = next;
    setDraft(next);
    void editor.renameNode(item.id, from, to, next).then((err) => {
      if (!err) return;
      sent.current = item.body;
      setDraft(before);
      editor.pickNode(item.id, from);
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      flush();
      editor.close();
      return;
    }
    /* Tab indents — a DSL is written in blocks, and the alternative is Tab leaving the box. */
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: t, value } = el;
      const next = `${value.slice(0, s)}  ${value.slice(t)}`;
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };

  /* The cheat sheet for this dialect, from the running server — the grammar as implemented. The
     `edges` fence has one too: it is not a diagram type, and it is still a grammar to look up. */
  const diagram = isDiagramType(item.type);
  const links = isLinkType(item.type);
  /* A link is changed with the pointer and the panel, never by typing its statement (#145), so its
     grammar has no sheet to look up. */
  const sheetable = diagram;
  const linkEnds = useMemo(() => (links ? linkEndChoices(boardItems, item.page) : undefined), [links, boardItems, item.page]);
  useEffect(() => {
    if (!sheetable || !showSheet) return;
    let live = true;
    setSheet(null);
    fetch(`/__board/dsl?type=${encodeURIComponent(item.type)}`)
      .then((r) => r.json() as Promise<{ text?: string }>)
      .then((d) => live && setSheet(d.text ?? "No cheat sheet for this type."))
      .catch(() => live && setSheet("Could not load the cheat sheet."));
    return () => {
      live = false;
    };
  }, [sheetable, showSheet, item.type]);

  /*
   * What the strip is for, and where in the *draft* it is written.
   *
   * The pick is the source of truth and the caret is a feeder into it — the reverse of M27, where
   * the caret was the truth and a double-click moved it. That inversion is what lets one control
   * serve both: clicking a card on the canvas picks it, arrowing down the source picks whatever
   * that line declares, and the strip cannot disagree with either because it reads neither.
   *
   * A node pick carries only its id, so the line is derived here — against the draft, which may be
   * a quarter of a second ahead of the file, and which is the text every writer below splices. An
   * edge has no author id (`e3` is the parser's), so the pick carries the line it was picked at and
   * `declaredAt` is asked first in case an edit above has moved it.
   */
  const pickedNode = editor.pickedNode;
  const pickedEdge = editor.pickedEdge;
  const pickedLink = editor.pickedLink;
  const subject = useMemo<Subject | null>(() => {
    /*
     * An `edges` fence is the one item that is not a diagram and still has a pickable thing in it.
     * A board link is picked on the canvas rather than in this panel, so what arrives here is an
     * id out of `board.links`; its statement is a line of *this* fence's body, and `segOf` says
     * which arrow on that line — the same counting `edgeAt` does for a diagram's own chains.
     */
    if (isLinkType(item.type)) {
      const link = pickedLink === null ? undefined : boardLinks.find((l) => l.id === pickedLink && l.fence === item.id);
      if (!link) return null;
      const line = link.line - item.line;
      const nth = boardLinks.filter((l) => l.fence === item.id && l.line === link.line).indexOf(link);
      return { id: link.id, what: "edge", line, seg: segOf(draft.split("\n")[line - 1] ?? "", nth), link: true };
    }
    if (!isDiagramType(item.type)) return null;
    if (pickedNode && pickedNode.item === item.id) {
      const line = declaredAt(item.type, draft, pickedNode.node, item.dir);
      if (line === null) return null;
      const at = declaredOn(item.type, draft, line, item.dir);
      return { id: pickedNode.node, what: at?.what === "edge" ? "node" : (at?.what ?? "node"), line, seg: 0 };
    }
    if (pickedEdge && pickedEdge.item === item.id) {
      const line = declaredAt(item.type, draft, pickedEdge.id, item.dir) ?? pickedEdge.line;
      return { id: pickedEdge.id, what: "edge", line, seg: pickedEdge.seg };
    }
    return null;
  }, [pickedNode, pickedEdge, pickedLink, boardLinks, item.id, item.type, item.dir, item.line, draft]);

  /*
   * The panel has no Source tab (#145, decided on #132: removed, not hidden behind a setting). A
   * diagram's body is a language and everything it says has a control, so the panel is those
   * controls and the canvas. The box below is for what is not a language: an image's caption and a
   * prompt card's request. An `edges` fence's statements are the links on the canvas, each changed
   * by picking it, and an `md` card's text is written on the card itself (`CardText`).
   */
  const prose = item.type === "md";
  const showSource = !links && !prose && !diagram;

  /* Pulling the panel wider. Painted straight onto the element for the duration — this is the
     `Viewport` split again — and only the settled value reaches React and `localStorage`. */
  const onGrip = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = e.currentTarget.parentElement;
    if (!panel) return;
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    let w = startW;
    const onMove = (ev: PointerEvent) => {
      w = Math.min(MAX_W, Math.max(MIN_W, startW - (ev.clientX - startX)));
      panel.style.setProperty("--inspector-w", `${Math.round(w)}px`);
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      setWidth(Math.round(w));
      writePref(INSPECTOR_WIDTH, String(Math.round(w)));
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  };

  return (
    <aside
      className="dag-inspector"
      data-dag-inspector=""
      aria-label={`Edit ${item.id}`}
      style={{ "--inspector-w": `${width}px` } as CSSProperties}
    >
      <div
        className="dag-inspector__grip"
        data-dag-grip=""
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to widen the editor"
        onPointerDown={onGrip}
      />
      <header className="dag-inspector__head">
        <span className="dag-inspector__type" data-dag-inspector-type={item.type}>
          {itemName(item.type)}
        </span>
        {/* What a person called it, when they did; the id is the file's name for it and only
            said here when there is nothing better. */}
        {item.title ? (
          <span className="dag-inspector__name" title={`${boardName} · #${item.id}`}>
            {item.title}
          </span>
        ) : (
          <span className="dag-inspector__id" title={`${boardName} · #${item.id}`}>
            #{item.id}
          </span>
        )}
        <span className="dag-toolbar__spacer" />
        {sheetable ? (
          <button
            type="button"
            className={showSheet ? "dag-icon dag-icon--on" : "dag-icon"}
            aria-pressed={showSheet}
            title="Show the cheat sheet for this type"
            onClick={() => setShowSheet((v) => !v)}
          >
            <BookOpen {...ICON} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="dag-icon" aria-label="Close the editor (Esc)" onClick={() => (flush(), editor.close())}>
          <X {...ICON} aria-hidden="true" />
        </button>
      </header>

      {/* What is wrong here that a person can act on (#145), at the top, where it is read first:
          each in words, with Show — which picks the card or link it concerns, so the control that
          fixes it is the next thing on screen — and the fix itself where a row can carry one out.
          Nothing about lines, codes or grammar: those are an agent's, and the panel never shows the
          text they point into. */}
      {problems.length > 0 ? (
        <ProblemsBlock
          problems={problems}
          onShow={(p) => editor.openOn(item.id, p.target)}
          onDeleteEdge={(p) => {
            const line = p.target ? declaredAt(item.type, draft, p.target.id, item.dir) : null;
            if (line === null) return;
            editor.pickNode(item.id, null);
            onChange(removeEdge(draft, line));
          }}
          repairOf={repairOf}
          onRepair={onRepair}
        />
      ) : null}

      {/* A Mermaid paste, and the one button that turns it into this grammar. Offered only where
          the detector is already certain — a header means the block is another language end to end
          — so nothing that merely resembles Mermaid can be rewritten by accident. In both halves,
          because it is a fact about the item rather than about the text: a person who never opens
          Source is exactly the person who most needs to be offered the conversion. */}
      {diagram || links ? (
        <MermaidOffer
          body={draft}
          onConvert={(type, body, dir) => {
            flush();
            editor.replace(item.id, { type, body, ...(dir ? { attrs: { dir } } : null) });
            setDraft(body);
            sent.current = body;
          }}
        />
      ) : null}

      {/*
       * The controls. One subject at a time: whatever is picked *inside* this item, or — with
       * nothing picked — the item's own fields.
       *
       * The pick's half shows in **both** views, because it is what a person is working on in
       * either one; the item's shows only where the item is what the panel is about, which is the
       * Properties half or an item that has no halves at all. Every control hands the whole body
       * back through `onChange`, so it goes through this panel's debounce, the same patch and the
       * same undo entry as a keystroke. There is no second write path.
       */}
      <Props
        item={item}
        editor={editor}
        pages={pages}
        body={draft}
        subject={subject}
        showItem
        onBody={onChange}
        onRenameNode={onRenameNode}
        linkEnds={linkEnds}
      />

      {links && !subject ? (
        <p className="dag-inspector__hint" data-dag-links-hint="">
          Click a link on the canvas to change it, or drag from the edge of a card to draw one.
        </p>
      ) : null}

      {prose ? (
        <button type="button" className="dag-button" data-dag-write-card="" onClick={() => editor.write(item.id)}>
          Edit the text
        </button>
      ) : null}

      {showSource ? (
        <textarea
          ref={area}
          className="dag-inspector__body"
          data-dag-body=""
          value={draft}
          spellCheck={item.type === "md" || item.type === "prompt"}
          placeholder={
            item.type === "prompt"
              ? "Describe the diagram to draw"
              : item.type === "image"
                ? "A caption"
                : item.type === "md"
                  ? "Markdown"
                  : links
                    ? 'one link per line: `a --> b "label"`'
                    : `${item.type} source`
          }
          aria-label={`${item.type} source`}
          onChange={(e) => onChange(e.target.value)}
          onBlur={flush}
          onKeyDown={onKeyDown}
        />
      ) : null}

      {sheetable && showSheet ? (
        <div className="dag-inspector__sheet dag-md">
          {sheet === null ? <p>Loading…</p> : <ReactMarkdown components={SHEET}>{sheet}</ReactMarkdown>}
        </div>
      ) : null}

      <footer className="dag-inspector__foot">
        {showSource ? "Esc or Ctrl+Enter to close · Tab indents" : "Esc to close · click a card to pick it"}
      </footer>
    </aside>
  );
}

/**
 * "This is Mermaid — shall I write it out in this grammar?"
 *
 * The detector has said so for a long time and the only thing it could offer was a paragraph of
 * prose: delete this line, the label goes in quotes, `subgraph` is `group`. For a forty-line paste
 * that is an afternoon of retyping, and the reason the whole thing was listed as deliberately not
 * built. `fromMermaid` does the three dialects that account for nearly every paste; what it cannot
 * translate comes through as a comment, and the count is said out loud here rather than left for
 * the author to discover by reading.
 *
 * The button changes the fence's *type* as well as its body, because a `graph LR` typed into an
 * `arch` fence is a `flow` and converting it without moving it would trade one pile of errors for
 * another.
 */
function MermaidOffer({ body, onConvert }: { body: string; onConvert(type: ItemType, body: string, dir?: "LR" | "TB"): void }) {
  const found = useMemo(() => (detectMermaid(body).fatal ? fromMermaid(body) : null), [body]);
  if (!found) return null;
  return (
    <div className="dag-offer" data-dag-mermaid-offer={found.type}>
      <p className="dag-offer__text">
        This is Mermaid. It can be written out as <code>{found.type}</code>
        {found.left > 0 ? `; ${found.left} line${found.left === 1 ? "" : "s"} will come through as a comment` : ""}.
      </p>
      <button
        type="button"
        className="dag-offer__go"
        data-dag-mermaid-convert=""
        onClick={() => onConvert(found.type as ItemType, found.body, found.dir)}
      >
        <Wand2 {...ICON} aria-hidden="true" /> Convert
      </button>
    </div>
  );
}

/**
 * The panel's Problems block: what is wrong with this item that a person can do something about.
 *
 * `listProblems` has already left out everything else, so every row here has an answer: Show picks
 * the thing the problem is about, a link that ends on nothing can be deleted from the row, and a
 * board setting the file got wrong carries its repair, as it does in the dock.
 */
function ProblemsBlock({
  problems,
  onShow,
  onDeleteEdge,
  repairOf,
  onRepair,
}: {
  problems: readonly Problem[];
  onShow(p: Problem): void;
  onDeleteEdge(p: Problem): void;
  repairOf?(p: Problem): Repair | null;
  onRepair?(fix: Fix): Promise<string | null>;
}) {
  return (
    <section className="dag-inspector__problems" data-dag-inspector-problems="" aria-label="Problems">
      <ul className="dag-inspector__problem-list">
        {problems.map((p, i) => (
          <li
            key={`${p.key}@${p.line}#${i}`}
            className={`dag-inspector__problem dag-inspector__problem--${p.severity}`}
            data-dag-inspector-problem={p.code}
          >
            <span className="dag-inspector__problem-words">{p.words}</span>
            <span className="dag-inspector__problem-acts">
              {p.target ? (
                <button type="button" className="dag-inspector__problem-act" data-dag-problem-show="" onClick={() => onShow(p)}>
                  Show
                </button>
              ) : null}
              {p.fix === "delete-edge" ? (
                <button
                  type="button"
                  className="dag-inspector__problem-act"
                  data-dag-problem-delete=""
                  onClick={() => onDeleteEdge(p)}
                >
                  Delete link
                </button>
              ) : null}
            </span>
            {onRepair ? <RepairBox repair={repairOf?.(p) ?? null} code={p.code} onRepair={onRepair} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
