import { useContext, useMemo, type ComponentProps, type ComponentType, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkWikilinks } from "@/refs/wikilinks";

import { remarkAnchors } from "@/note/anchors";
import { remarkMath } from "@/note/math";
import { urlTransform } from "@/refs/Ref";
import { AssetUrlContext, ownAssets } from "@/render/assets";

/**
 * Where a note's image actually is, for its owner: its own folder's `.assets/`, unless the source is
 * already a URL — the same rule `ImageItem` follows for a board. The note editor reads this; a page
 * drawing a note read-only asks `AssetUrlContext`, which is this unless the page is a share link's.
 */
/* GFM, equations between dollars, and a block's `^id` taken off its words. */
const PLUGINS = [remarkGfm, remarkMath, remarkAnchors, remarkWikilinks];

export function resolverFor(name: string) {
  return (src: string) => ownAssets(name, src);
}

/**
 * A caller's `img`, as the component it always is here.
 *
 * `Components["img"]` also admits the name of any intrinsic element an image's props would fit, so a
 * JSX element over it is checked against every tag there is. The cast is type-only: what renders is
 * the same value either way.
 */
export type MarkdownImg = ComponentType<ComponentProps<"img"> & ExtraProps>;

/**
 * `components` with some of them replaced, as one object — what `{ ...base, ...over }` means.
 *
 * `Object.assign` rather than the spread for the type checker alone. A spread of a `Components`
 * makes TypeScript build a fresh object type of its hundred and seventy optional keys, each a union
 * of up to a hundred and seventy tags, and then compare it with `Components` key by key: that one
 * expression was over a third of the time `tsc` spent checking the whole project. The object is the
 * same at runtime — every key of `base`, then every key of `over` on top.
 */
export function withComponents(base: Components | undefined, over: Components): Components {
  return Object.assign({}, base, over);
}

/**
 * A note's Markdown, drawn read-only.
 *
 * `react-markdown`, the renderer every board's text already uses, and never BlockNote: a picture of
 * a note is a fact about the file, and the editor is several hundred kilobytes a reader does not
 * need. A block's `^id` anchor comes off the words and onto the element (`remarkAnchors`), so
 * `#^name` scrolls to it.
 *
 * `body` is the Markdown *after* the frontmatter — `splitNote` is the caller's, because a body that
 * opens with a rule would otherwise be read as one.
 *
 * `components` is how a caller draws something a note links to — a cross reference, an embed —
 * without this component having to know what one is.
 */
export function NoteMarkdown({
  name,
  body,
  components,
}: {
  name: string;
  body: string;
  components?: Components;
}): ReactNode {
  const assets = useContext(AssetUrlContext);
  /* A caller's `img` draws what it knows — a reference's embed — and every other image is this
     note's, relative to its folder. Memoised, because to React it is a component type: a new one on
     every render unmounted every embed under it, an embedded board included (see `refComponents`). */
  const all = useMemo(() => {
    const Theirs = components?.img as MarkdownImg | undefined;
    const img: MarkdownImg = (props) => {
      if (Theirs && typeof props.src === "string" && props.src.startsWith("dag:")) return <Theirs {...props} />;
      const { node: _node, src, ...rest } = props;
      return <img {...rest} src={src ? assets(name, String(src)) : src} />;
    };
    return withComponents(components, { img });
  }, [components, assets, name]);
  return (
    <article className="dag-note-view__page dag-md">
      <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={urlTransform} components={all}>
        {body}
      </ReactMarkdown>
    </article>
  );
}
