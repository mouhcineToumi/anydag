import { AlertCircle, ChevronDown, MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { Hue } from "@/dsl/ir";
import { defaultHue, tagKey, tagOf, tagProblem, typedTag } from "@/note/tags";
import { hueVars } from "@/render/hue";
import { Button, IconButton } from "@/ui/controls";
import { Dialog } from "@/ui/Dialog";
import { Palette, hueLabel } from "@/ui/Palette";
import { useUnder } from "@/ui/tags/TagChip";
import { colorTag, deleteTag, renameTag, tagIn, useTagList, type TagDoc, type TagInfo } from "@/ui/tags/tagStore";
import { Toast } from "@/ui/Toast";
import { leaf } from "@/ui/tree";

import { useLocked } from "../lock";
import { Group, ICON } from "./common";

/** A count of documents as the row says it. */
const documents = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

/** What the pane's notice says: a deletion to take back, or a change that missed some files. */
type Notice =
  | { kind: "deleted"; name: string; hue: Hue | null }
  | { kind: "partial"; verb: "Renamed in" | "Removed from"; done: number; missed: TagDoc[]; retry(): void };

/**
 * The vault's tags (#327): Settings → This vault → Tags, because the colours are the vault's. There
 * is no *New tag* — tags are made where they are used — so the pane lists what there is: each tag's
 * colour, which opens the ten swatches; its name, which renames it in place (onto a tag that exists
 * it asks to merge); how many documents carry it, *Unused* for none; and a quiet `⋯` with Rename and
 * Delete….
 *
 * A tag the vault has never registered — written in a file by hand or by Obsidian — shows its default
 * colour as a ring until someone picks one. Deleting an unused tag is done at once, with Undo; one
 * that documents carry asks first, in a dialog whose one danger is Remove. A rename or a delete that
 * cannot write some file rolls nothing back: the notice says which, and *Try again* finishes it.
 */
export function TagsPane() {
  const list = useTagList();
  const locked = useLocked();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [asking, setAsking] = useState<TagInfo | null>(null);

  const remove = async (tag: TagInfo) => {
    setNotice(null);
    const done = await deleteTag(tag.name);
    if (!done.ok) return;
    const { files, missed, registered, hue } = done.got;
    if (missed.length)
      setNotice({ kind: "partial", verb: "Removed from", done: files.length, missed, retry: () => void remove(tag) });
    else if (tag.count === 0 && registered) setNotice({ kind: "deleted", name: tag.name, hue });
  };

  const rename = async (from: string, to: string) => {
    setNotice(null);
    const done = await renameTag(from, to);
    if (!done.ok) return;
    const { files, missed } = done.got;
    if (missed.length)
      setNotice({ kind: "partial", verb: "Renamed in", done: files.length, missed, retry: () => void rename(from, to) });
  };

  return (
    <div className="dag-tags__pane" data-dag-setting-tags="">
      <Group title="Tags in this vault">
        {list?.length ? (
          list.map((t) => (
            <TagRow
              key={tagKey(t.name)}
              tag={t}
              tags={list}
              locked={locked}
              onRename={(to) => void rename(t.name, to)}
              onDelete={() => (t.count === 0 ? void remove(t) : setAsking(t))}
            />
          ))
        ) : (
          <p className="dag-tags__none">{list ? "No tags yet." : "Loading the tags…"}</p>
        )}
      </Group>
      <p className="dag-settings__hint">
        Create tags where you use them: type a new name in any document's Tags. A tag made that way stays listed here, even when
        no document carries it. A tag found only in files, written by hand or in Obsidian, shows its default colour as a ring
        until someone picks one. A tag marked Unused is on no document.
      </p>

      {asking ? (
        <Dialog
          role="alertdialog"
          aria-label="Remove a tag"
          className="dag-settings dag-purge"
          scrim={{ "data-dag-tag-delete-ask": asking.name }}
          onClose={() => setAsking(null)}
        >
          <div className="dag-settings__head">
            <AlertCircle {...ICON} className="dag-purge__mark" aria-hidden="true" />
            <h2>
              Remove “{asking.name}” from {documents(asking.count)}?
            </h2>
          </div>
          <p className="dag-purge__what">
            {asking.count === 1 ? "The document keeps" : `Each of the ${asking.count} documents keeps`} everything else; only “
            {asking.name}” is taken off.
          </p>
          <div className="dag-settings__foot dag-purge__foot">
            <Button onClick={() => setAsking(null)}>Cancel</Button>
            <Button
              variant="danger"
              data-dag-tag-delete-confirm=""
              autoFocus
              onClick={() => {
                const tag = asking;
                setAsking(null);
                void remove(tag);
              }}
            >
              Remove
            </Button>
          </div>
        </Dialog>
      ) : null}

      {notice?.kind === "deleted" ? (
        <Toast
          inline
          icon={Trash2}
          data-dag-tag-deleted={notice.name}
          timeout={6000}
          onTimeout={() => setNotice(null)}
          onDismiss={() => setNotice(null)}
          actions={
            <Button
              size="sm"
              data-dag-tag-undo=""
              onClick={() => {
                setNotice(null);
                void colorTag(notice.name, notice.hue);
              }}
            >
              <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
              Undo
            </Button>
          }
        >
          Deleted “{notice.name}”.
        </Toast>
      ) : null}
      {notice?.kind === "partial" ? (
        <Toast
          inline
          tone="danger"
          role="alert"
          icon={AlertCircle}
          data-dag-tag-partial=""
          onDismiss={() => setNotice(null)}
          actions={
            <Button size="sm" data-dag-tag-retry="" onClick={notice.retry}>
              Try again
            </Button>
          }
        >
          {notice.verb} {notice.done} of {documents(notice.done + notice.missed.length)}. “{leaf(notice.missed[0]!.name)}”
          {notice.missed.length > 1 ? ` and ${notice.missed.length - 1} more` : ""} kept changing.
        </Toast>
      ) : null}
    </div>
  );
}

/** One tag's row: its colour, its name, its count and its `⋯` — or the question a rename asks. */
function TagRow({
  tag,
  tags,
  locked,
  onRename,
  onDelete,
}: {
  tag: TagInfo;
  tags: readonly TagInfo[];
  locked: boolean;
  onRename(to: string): void;
  onDelete(): void;
}) {
  const [colouring, setColouring] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [merging, setMerging] = useState<TagInfo | null>(null);
  const [menu, setMenu] = useState(false);
  const swatch = useRef<HTMLButtonElement>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const mergeButton = useRef<HTMLButtonElement>(null);
  const at = useUnder(swatch, colouring);
  const fallback = defaultHue(tag.name);
  const [menuAt, setMenuAt] = useState<CSSProperties | null>(null);

  /* A press outside a picker or the menu shuts it. */
  useEffect(() => {
    if (!colouring && !menu) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || swatch.current?.contains(t)) return;
      if (menuEl.current?.contains(t) || more.current?.contains(t)) return;
      setColouring(false);
      setMenu(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [colouring, menu]);

  useEffect(() => {
    if (colouring && at) card.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [colouring, at]);

  useLayoutEffect(() => {
    if (!menu) return setMenuAt(null);
    const r = more.current?.getBoundingClientRect();
    if (!r) return;
    setMenuAt({ top: r.bottom + 4, right: Math.max(8, innerWidth - r.right) });
  }, [menu]);
  useEffect(() => {
    if (menu && menuAt) menuEl.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu, menuAt]);

  useEffect(() => {
    if (draft !== null) field.current?.select();
  }, [draft !== null]);
  useEffect(() => {
    if (merging) mergeButton.current?.focus();
  }, [merging]);

  const choose = (hue: Hue | null) => {
    setColouring(false);
    swatch.current?.focus();
    void colorTag(tag.name, hue);
  };

  const startRename = () => {
    setMenu(false);
    setDraft(tag.name);
  };
  const stopRename = () => {
    setDraft(null);
    requestAnimationFrame(() => nameButton.current?.focus());
  };
  const commit = () => {
    const to = draft ?? "";
    if (!tagOf(to)) return;
    if (to === tag.name) return stopRename();
    const there = tagIn(tags, to);
    setDraft(null);
    if (there && tagKey(there.name) !== tagKey(tag.name)) return setMerging(there);
    onRename(to);
  };
  const problem = draft !== null ? tagProblem(draft) : undefined;

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuEl.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      more.current?.focus();
    } else if (e.key === "Tab") setMenu(false);
  };

  if (merging)
    return (
      <div
        className="dag-tags__row"
        role="group"
        aria-label={`Merge ${tag.name} into ${merging.name}`}
        data-dag-tag-row={tag.name}
      >
        <span className="dag-tags__swatch dag-tags__swatch--still">
          <span className="dag-tags__dot" style={hueVars(tag.hue)} data-default={tag.registered ? undefined : ""} />
        </span>
        <span className="dag-tags__ask" data-dag-tag-merge-ask={merging.name}>
          <b>Merge into “{merging.name}”?</b>
          <span>
            {tag.count === 0
              ? `${tag.name} is on no document; it goes, and ${merging.name} stays.`
              : `${documents(tag.count)} tagged ${tag.name} will carry ${merging.name}.`}
          </span>
        </span>
        <Button variant="quiet" size="sm" onClick={() => setMerging(null)}>
          Cancel
        </Button>
        <Button
          ref={mergeButton}
          variant="primary"
          size="sm"
          data-dag-tag-merge=""
          onClick={() => {
            const to = merging.name;
            setMerging(null);
            onRename(to);
          }}
        >
          Merge
        </Button>
      </div>
    );

  return (
    <div className="dag-tags__row" data-dag-tag-row={tag.name}>
      <button
        ref={swatch}
        type="button"
        className="dag-tags__swatch"
        data-dag-tag-colour={tag.name}
        aria-label={`Colour of ${tag.name}: ${hueLabel(tag.hue)}${tag.registered ? "" : ", the default"}`}
        aria-haspopup="dialog"
        aria-expanded={colouring}
        disabled={locked}
        onClick={() => setColouring((v) => !v)}
      >
        <span className="dag-tags__dot" style={hueVars(tag.hue)} data-default={tag.registered ? undefined : ""} />
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {colouring ? (
        <div
          ref={card}
          className="dag-tag__hues"
          role="dialog"
          aria-label={`Colour of ${tag.name}`}
          data-dag-tag-hues={tag.name}
          style={at ?? { visibility: "hidden" }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            setColouring(false);
            swatch.current?.focus();
          }}
        >
          <Palette
            value={tag.hue}
            fallback={fallback}
            label="Colour"
            onPick={choose}
            onEscape={() => {
              setColouring(false);
              swatch.current?.focus();
            }}
          />
          {tag.registered && tag.hue !== fallback ? (
            <Button variant="quiet" size="sm" className="dag-tag__reset" data-dag-tag-default="" onClick={() => choose(null)}>
              Use the default colour
            </Button>
          ) : null}
        </div>
      ) : null}

      {draft !== null ? (
        <span className="dag-tags__rename">
          <input
            ref={field}
            className="dag-tags__input"
            data-dag-tag-rename-input={tag.name}
            aria-label={`Rename ${tag.name}`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `dag-tag-rename-${tagKey(tag.name)}` : undefined}
            spellCheck={false}
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(typedTag(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                stopRename();
              }
            }}
            onBlur={() => setDraft(null)}
          />
          {problem ? (
            <span className="dag-tags__problem" id={`dag-tag-rename-${tagKey(tag.name)}`} role="alert">
              {problem.message}
            </span>
          ) : null}
        </span>
      ) : (
        <button
          ref={nameButton}
          type="button"
          className="dag-tags__name"
          data-dag-tag-name={tag.name}
          aria-label={`Rename ${tag.name}`}
          disabled={locked}
          onClick={startRename}
        >
          {tag.name}
        </button>
      )}
      {tag.registered ? null : <span className="dag-tags__default">Default colour</span>}
      <span className="dag-tags__count" data-none={tag.count === 0 ? "" : undefined} data-dag-tag-count={tag.count}>
        {tag.count === 0 ? "Unused" : documents(tag.count)}
      </span>
      <IconButton
        ref={more}
        className={menu ? "dag-tags__more dag-icon--on" : "dag-tags__more"}
        data-dag-tag-more={tag.name}
        aria-label={`More for ${tag.name}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        disabled={locked}
        onClick={() => setMenu((v) => !v)}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </IconButton>
      {menu ? (
        <div
          ref={menuEl}
          className="dag-tags__menu"
          role="menu"
          aria-label={`More for ${tag.name}`}
          style={menuAt ?? { visibility: "hidden" }}
          onKeyDown={onMenuKey}
        >
          <button type="button" role="menuitem" className="dag-more__item" data-dag-tag-menu="rename" onClick={startRename}>
            <Pencil {...ICON} aria-hidden="true" />
            <span>Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="dag-more__item"
            data-dag-tag-menu="delete"
            onClick={() => {
              setMenu(false);
              onDelete();
            }}
          >
            <Trash2 {...ICON} aria-hidden="true" />
            <span>Delete…</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
