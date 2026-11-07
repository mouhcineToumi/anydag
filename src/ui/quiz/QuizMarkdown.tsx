import { useContext, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkWikilinks } from "@/refs/wikilinks";

import { remarkMath } from "@/note/math";
import { refComponents, urlTransform } from "@/refs/Ref";
import { AssetUrlContext } from "@/render/assets";
import { withComponents, type MarkdownImg } from "@/view/NoteRead";

/* GFM, and equations between dollars. */
const PLUGINS = [remarkGfm, remarkMath, remarkWikilinks];

const Span = ({ children }: { children?: ReactNode }) => <span>{children}</span>;

/**
 * A piece of a quiz — a prompt, an option, an explanation — drawn as the Markdown it is written in.
 *
 * `react-markdown` with the references a note draws (`dag:` links through `urlTransform`, which the
 * renderer would otherwise empty), and a picture relative to the quiz's own folder through
 * `AssetUrlContext`, which is a share link's route when the page is one. **Never an editor**: the
 * runner and the sheet are what the read-only view draws, and `test/view-graph.test.ts` holds that
 * view to importing nothing from `src/edit/`.
 *
 * **A board embedded on a line of its own is drawn** — the read-only renderer a note's
 * embed already uses, fitted to the question's width — in the description, a prompt's body, an
 * option of more than one line and an explanation. Not in `inline`, which is one line of Markdown
 * drawn inside a label or a heading, where a drawing is a block that cannot go.
 *
 * **The components are made once per quiz and mode**, not per render: they are component types to
 * React, and a fresh `img` on every render unmounted an embedded board and drew it again — back to
 * loading — every time a run redrew, which is every pick.
 */
export function QuizMarkdown({ name, md, inline = false }: { name: string; md: string; inline?: boolean }): ReactNode {
  const assets = useContext(AssetUrlContext);
  const components = useMemo(() => {
    const refs = refComponents({ boards: !inline });
    /* A `dag:` picture is a reference's embed, which the references draw; every other one is this
       quiz's, relative to its folder — `NoteMarkdown`'s rule. */
    const Theirs = refs.img as MarkdownImg | undefined;
    const img: MarkdownImg = (props) => {
      if (Theirs && typeof props.src === "string" && props.src.startsWith("dag:")) return <Theirs {...props} />;
      const { node: _node, src, ...rest } = props;
      return <img {...rest} src={src ? assets(name, String(src)) : src} />;
    };
    return withComponents(refs, inline ? { p: Span, img } : { img });
  }, [assets, name, inline]);
  if (!md.trim()) return null;
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={urlTransform} components={components}>
      {md}
    </ReactMarkdown>
  );
}
