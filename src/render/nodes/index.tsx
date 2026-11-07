import type { DiagramType, Node } from "@/dsl/ir";
import type { Box } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "../hue";
import { Icon, iconFor, tileClass } from "../Icon";
import { emOf } from "./em";
import { ServiceCard } from "./ServiceCard";
import { isShape } from "@/layout/shapes";

import { SketchBox, SketchButton, SketchFigure, SketchImg, SketchInk, SketchInput, SketchShape, SketchText, Sticky } from "./Sketch";

/**
 * One component per node kind, and the dispatcher that picks it.
 *
 * Rule 5 says every diagram shares one node anatomy — a mono id or icon, a title, and a foot of
 * real data — and these are variations on it rather than twelve unrelated shapes. What varies is
 * the part that carries meaning: an entity's rows are columns, a class's are members in two
 * compartments, a use case has no rows at all and is a pill because UML draws an oval.
 */

export interface NodeProps {
  node: Node;
  box: Box;
  theme: Theme;
  /**
   * The dialect the node was written in. `db` and `container` are words in two of them — a C4
   * box with a wrapping description in `c4`, and an icon-first card like `store` in `arch` — and
   * the kind alone cannot say which. Without it, a database in an architecture diagram came out
   * labelled `[Container: —]`.
   */
  type?: DiagramType;
}

const statusClass = (node: Node): string =>
  node.status === "done"
    ? " dag-node--done"
    : node.status === "wait"
      ? " dag-node--wait"
      : node.status === "stop"
        ? " dag-node--stop"
        : node.status === "muted"
          ? " dag-node--muted"
          : "";

const frame = (node: Node, extra: string) =>
  `dag-node ${extra}${statusClass(node)}${node.external ? " dag-node--external" : ""}`;

const place = (box: Box) => ({ left: box.x, top: box.y, width: box.w, height: box.h });

/** ER entity: a hue dot, a mono table name, then one row per column. */
function EntityCard({ node, box, theme }: NodeProps) {
  return (
    <div
      className={frame(node, "dag-node--entity")}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ ...place(box), ...hueVars(node.hue) }}
    >
      <div className="dag-node__head dag-node__head--entity" style={{ height: theme.metric.node.headerEntity }}>
        <span className="dag-group__dot" />
        <span className="dag-entity__name" data-dag-title="" {...emOf(node)}>{node.title}</span>
      </div>
      <div className="dag-node__rows">
        {node.rows.map((row) => (
          <div className="dag-row dag-row--entity" key={row.id} data-dag-row={row.id} style={{ height: theme.metric.node.rowEntity }}>
            {row.kind === "more" ? (
              <span className="dag-row__more">{row.name}</span>
            ) : (
              <>
                <span className="dag-row__field">{row.name}</span>
                {row.detail ? <span className="dag-row__type">{row.detail}</span> : null}
                {row.tags.includes("pk") ? <span className="dag-key dag-key--pk">pk</span> : null}
                {row.tags.includes("fk") ? (
                  <span
                    className="dag-key dag-key--fk"
                    style={hueVars(row.fkHue ?? node.hue)}
                  >
                    fk
                  </span>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A class box: an optional stereotype, the name, then attributes and methods in separate bands. */
function ClassBox({ node, box, theme }: NodeProps) {
  return (
    <div className={frame(node, "dag-node--class")} data-dag-node={node.id} data-dag-kind={node.kind} style={place(box)}>
      <div
        className="dag-class__head"
        style={{ height: node.stereotype ? theme.metric.node.headerClassStereo : theme.metric.node.headerClass }}
      >
        {node.stereotype ? <span className="dag-class__stereo">{node.stereotype}</span> : null}
        <span className="dag-node__title" data-dag-title="" {...emOf(node)}>{node.title}</span>
      </div>
      {(node.compartments ?? []).map((rows, i) => (
        <div className="dag-class__comp" key={i}>
          {rows.map((row) => (
            <div className="dag-row dag-row--class" key={row.id} data-dag-row={row.id} style={{ height: theme.metric.node.rowClass }}>
              <span className="dag-vis">{row.vis ?? ""}</span>
              <span className="dag-row__member">{row.name}</span>
              {row.detail ? <span className="dag-row__type">{row.kind === "attr" ? `: ${row.detail}` : row.detail}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A state: the name, and underneath it the value the field actually holds. */
function StateCard({ node, box }: NodeProps) {
  return (
    <div className={frame(node, "dag-node--state")} data-dag-node={node.id} data-dag-kind={node.kind} style={place(box)}>
      <span className="dag-node__title" data-dag-title="" {...emOf(node)}>{node.title}</span>
      {node.meta ? <span className="dag-state__value">{node.meta}</span> : null}
    </div>
  );
}

/** A flow step: a mono id, an optional `async` pill, the title, and a hue dot over the meta. */
function StepCard({ node, box, theme }: NodeProps) {
  return (
    <div
      className={frame(node, "dag-node--step")}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ ...place(box), ...hueVars(node.hue) }}
    >
      <span className="dag-step__idrow">
        <span className="dag-step__id">{node.id}</span>
        {node.async ? <span className="dag-pill">async</span> : null}
        {node.status === "done" ? (
          <svg
            width={theme.metric.node.tickSize}
            height={theme.metric.node.tickSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--dag-color-success)"
            strokeWidth={theme.metric.node.tickStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : null}
      </span>
      <span className="dag-step__title" data-dag-title="" {...emOf(node)}>{node.title}</span>
      {node.meta ? (
        <span className="dag-step__foot">
          <span className="dag-group__dot" />
          <span className="dag-step__meta">{node.meta}</span>
        </span>
      ) : null}
    </div>
  );
}

/** A decision: a pill, because a diamond is a sharp corner in a system that has none. */
function DecisionPill({ node, box }: NodeProps) {
  return (
    <div
      className={frame(node, "dag-node--decision")}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ ...place(box), ...hueVars(node.hue) }}
    >
      <span className="dag-step__id">{node.id}</span>
      <span className="dag-decision__title" data-dag-title="" {...emOf(node)}>{node.title}</span>
    </div>
  );
}

/** A use case: UML's oval, as a pill, with the mono id that tells it from a decision. */
function UseCasePill({ node, box }: NodeProps) {
  return (
    <div className={frame(node, "dag-node--usecase")} data-dag-node={node.id} data-dag-kind={node.kind} style={place(box)}>
      <span className="dag-uc__id">{node.id}</span>
      <span className="dag-uc__title" data-dag-title="" {...emOf(node)}>{node.title}</span>
    </div>
  );
}

/** C4: name, `[Type: technology]`, and the one sentence in the system that wraps. */
function C4Box({ node, box, theme }: NodeProps) {
  const type =
    node.kind === "person"
      ? "[Person]"
      : node.kind === "extsystem"
        ? "[Software system]"
        : `[${node.kind === "db" ? "Container" : "Container"}: ${node.meta ?? "-"}]`;
  const icon = iconFor(node.kind, theme, node.icon);

  return (
    <div
      className={frame(node, "dag-node--c4")}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      data-dag-icon={icon.mode}
      style={{ ...place(box), ...hueVars(node.hue) }}
    >
      <div className="dag-c4__head">
        <span className={tileClass(icon, node.kind === "person" ? "dag-tile--round dag-tile--c4" : "dag-tile--c4")}>
          <Icon icon={icon} size={theme.metric.tile.iconC4} stroke={theme.metric.tile.stroke} />
        </span>
        <span className="dag-c4__name" data-dag-title="" {...emOf(node)}>{node.title}</span>
      </div>
      <span className="dag-c4__type">{type}</span>
      {node.desc ? <span className="dag-c4__desc">{node.desc}</span> : null}
    </div>
  );
}

/** The pseudostates and the fork/join bars: ink, because they are notation rather than content. */
function Pseudo({ node, box, theme }: NodeProps) {
  const r = box.w / 2;
  const ring = theme.metric.line.rule;
  return (
    <svg
      className="dag-pseudo"
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ left: box.x, top: box.y }}
      width={box.w}
      height={box.h}
      aria-hidden="true"
    >
      {node.kind === "start" ? (
        <circle cx={r} cy={r} r={r} fill="var(--dag-color-ink)" />
      ) : (
        <>
          {/* Inset by half the stroke so the ring's outer edge lands on the laid-out box. */}
          <circle cx={r} cy={r} r={r - ring / 2} fill="none" stroke="var(--dag-color-ink)" strokeWidth={ring} />
          <circle cx={r} cy={r} r={theme.metric.node.endInner / 2} fill="var(--dag-color-ink)" />
        </>
      )}
    </svg>
  );
}

function Bar({ node, box }: NodeProps) {
  return (
    <div
      className="dag-bar"
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    />
  );
}

/** A commit: a dot in the branch's hue and the message. Anything larger drowns the branch line. */
function CommitChip({ node, box }: NodeProps) {
  return (
    <div
      className={frame(node, "dag-node--commit")}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ ...place(box), ...hueVars(node.hue) }}
    >
      <span className="dag-group__dot" />
      <span className="dag-commit__label" data-dag-title="" {...emOf(node)}>{node.title}</span>
      {node.meta ? <span className="dag-commit__tag">{node.meta}</span> : null}
    </div>
  );
}

/** A mindmap topic: a chip on the branch's hue, the root a shade stronger. */
function TopicChip({ node, box }: NodeProps) {
  return (
    <div
      className={`dag-topic${node.root ? " dag-topic--root" : ""}`}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      style={{ ...place(box), ...hueVars(node.hue) }}
    >
      {node.title}
    </div>
  );
}

export function NodeView(props: NodeProps) {
  switch (props.node.kind) {
    case "entity":
      return <EntityCard {...props} />;
    case "class":
    case "interface":
    case "abstract":
    case "enum":
      return <ClassBox {...props} />;
    case "state":
      return <StateCard {...props} />;
    case "step":
    case "action":
      return <StepCard {...props} />;
    case "decision":
      return <DecisionPill {...props} />;
    case "usecase":
      return <UseCasePill {...props} />;
    case "container":
    case "db":
      return props.type === "c4" ? <C4Box {...props} /> : <ServiceCard {...props} />;
    case "extsystem":
      return <C4Box {...props} />;
    case "person":
      /* A person with a description is C4's; without one it is a use case actor, which is the
         icon-first card everything else uses. */
      return props.node.desc ? <C4Box {...props} /> : <ServiceCard {...props} />;
    case "start":
    case "end":
      return <Pseudo {...props} />;
    case "fork":
    case "join":
      return <Bar {...props} />;
    case "commit":
      return <CommitChip {...props} />;
    case "topic":
      return <TopicChip {...props} />;
    /* The sketch vocabulary. Nothing here falls through to `ServiceCard`: a box that quietly
       acquired an icon tile and a hue would be the wrong drawing in the wrong language. */
    case "box":
      return <SketchBox {...props} />;
    case "text":
      return <SketchText {...props} />;
    case "button":
      return <SketchButton {...props} />;
    case "input":
      return <SketchInput {...props} />;
    case "img":
      return <SketchImg {...props} />;
    case "sticky":
      return <Sticky {...props} />;
    case "figure":
      return <SketchFigure {...props} />;
    case "ink":
      /* Beside the sketch kinds, never in the `isShape` branch: an ink stroke has no outline to
         compute and no hull worth casting anchors at — see `ir.ts` for why the router keeps the
         rectangle it falls back to. */
      return <SketchInk {...props} />;
    default:
      /* The geometric shapes are one component: what differs is an outline, and that is data. */
      if (isShape(props.node.kind)) return <SketchShape node={props.node} box={props.box} kind={props.node.kind} />;
      return <ServiceCard {...props} />;
  }
}
