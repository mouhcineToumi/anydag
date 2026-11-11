/**
 * A reference, drawn as a link, wearing the target's **live** title, and going to it by
 * id. Its own module rather than a part of `Ref.tsx`, because a table's link cells draw one too,
 * and `Ref.tsx` draws a table's card: one module importing the other would be a cycle.
 */
import type { ReactNode } from "react";

import { hrefFor, titleOf, useIndex, useSeek } from "./useIndex";
import { resolveWiki } from "./wikilinks";

/** A link to a note or a board, wearing the target's title as it is now. */
export function RefLink({ id, part, fallback }: { id: string; part?: string; fallback: ReactNode }) {
  const index = useIndex();
  const doc = index.byId.get(id);
  /* A link to something made a moment ago — the Assistant's answer naming the board it just made —
     asks for the index once more before it says the target is missing. */
  useSeek(id, !!doc, index.loaded);
  /* Before the index has answered, the brackets' own words; after, a target that is not there is
     said to be missing rather than drawn as a link to nowhere. */
  const missing = index.loaded && !doc;
  return (
    <a
      className={missing ? "dag-ref dag-ref--missing" : "dag-ref"}
      href={missing ? undefined : hrefFor(id, part)}
      data-dag-ref={id}
      data-dag-ref-kind={doc?.kind}
      title={missing ? "Nothing has this id any more" : doc?.name}
    >
      {doc ? titleOf(doc) : fallback}
    </a>
  );
}

/**
 * A `[[wikilink]]`: followed by name, through the vault's list, and drawn with the words
 * it was written with — `[[Plan|the plan]]` says *the plan*, as it does in every other editor of the
 * same folder. One that names nothing yet is drawn as such, and its words stay.
 */
export function WikiLink({ target, part, children }: { target: string; part?: string; children: ReactNode }) {
  const index = useIndex();
  const doc = target ? resolveWiki(target, index.docs) : undefined;
  const missing = index.loaded && !!target && !doc;
  return (
    <a
      className={missing ? "dag-ref dag-ref--missing dag-ref--wiki" : "dag-ref dag-ref--wiki"}
      href={doc ? hrefFor(doc.id, part) : !target && part ? `#${encodeURIComponent(part)}` : undefined}
      data-dag-ref={doc?.id}
      data-dag-wiki-target={target}
      data-dag-ref-kind={doc?.kind}
      title={missing ? `Nothing in this vault is called ${target}` : doc?.name}
    >
      {children}
    </a>
  );
}
