import type { Blueprint } from "./types";

/**
 * Layer 1: a container with something in it, or a node with rows.
 *
 * The two algebras show up here for the first time. A `group`, a `lane` and a `system` are braces,
 * so their children land in a `${children}` hole and the indent is written in the source rather
 * than added — the blueprint reads like its output. A sequence fragment and a gitgraph branch have
 * no braces at all: they are ordered statements, so they are a list of parts and nothing else.
 *
 * `${parent}` in a child's `id` is how a container names what is inside it — `grp1_svc`, `lane1_1`.
 * It is resolved during allocation, before anything is rendered, which is why it can only ever
 * point upwards.
 */

export const MOLECULES: Blueprint[] = [
  {
    id: "part-arch-group",
    layer: 1,
    type: "arch",
    name: "Group",
    description: "arch · a boundary with a hue.",
    icon: "Group",
    slot: "grp",
    source: 'group ${self} "${title}"${?meta} hue=${hue} {\n  ${children}\n}',
    props: { title: "Group", meta: "", hue: "teal" },
    parts: [{ use: "part-arch-service", props: { id: "${parent}_svc", meta: "" } }],
  },
  {
    id: "part-arch-service-rows",
    layer: 1,
    type: "arch",
    name: "Service with ports",
    description: "arch · a service whose rows an edge can address.",
    icon: "Server",
    slot: "svc",
    source: 'service ${self} "${title}"${?meta} icon=${icon} {\n  ${children}\n}',
    props: { title: "Service", meta: '"what runs it"', icon: "server" },
    parts: [
      { use: "part-arch-row", props: { id: "${parent}_a", text: "what it needs" } },
      { use: "part-arch-row", props: { id: "${parent}_b", text: "what else it needs" } },
    ],
  },
  {
    id: "part-flow-lane",
    layer: 1,
    type: "flow",
    name: "Lane",
    description: "flow · a band for who does it.",
    icon: "Rows3",
    slot: "lane",
    source: 'lane ${self} "${title}" hue=${hue} {\n  ${children}\n}',
    props: { title: "Who", hue: "teal" },
    parts: [{ use: "part-flow-step", props: { id: "${parent}_1" } }],
  },
  {
    id: "part-activity-lane",
    layer: 1,
    type: "activity",
    name: "Lane",
    description: "activity · a band with one action.",
    icon: "Rows3",
    slot: "lane",
    source: 'lane ${self} "${title}" hue=${hue} {\n  ${children}\n}',
    props: { title: "Who", hue: "teal" },
    parts: [{ use: "part-activity-action", props: { id: "${parent}_1" } }],
  },
  {
    id: "part-usecase-system",
    layer: 1,
    type: "usecase",
    name: "System",
    description: "usecase · the boundary, with one use case in it.",
    icon: "Layers",
    slot: "sys",
    source: 'system ${self} "${title}"${?meta} hue=${hue} {\n  ${children}\n}',
    props: { title: "The system", meta: "", hue: "teal" },
    parts: [{ use: "part-usecase-usecase", props: { id: "${parent}-1" } }],
  },
  {
    id: "part-c4-system",
    layer: 1,
    type: "c4",
    name: "System",
    description: "c4 · the system under discussion, with a container.",
    icon: "Layers",
    slot: "sys",
    source: 'system ${self} "${title}"${?meta} hue=${hue} {\n  ${children}\n}',
    props: { title: "System", meta: '"software system"', hue: "indigo" },
    parts: [{ use: "part-c4-container", props: { id: "${parent}_api" } }],
  },
  {
    /*
     * No braces: a fragment is a run of statements, and `end` is what closes it.
     *
     * **The participants are props, not slots.** These used to allocate an id and write `${id}_a`
     * and `${id}_b`, which produced `x1_a` and `x1_b` — two columns that were not on the diagram,
     * invented by the parser because a sequence gives any unheard-of id a column where it is first
     * mentioned. So "add an alt fragment" quietly added its messages between two strangers, and a
     * second drop reused the same two, because `x1` itself never appeared in the text for the
     * allocator to see. A fragment says something *about the conversation already there*, so it
     * names the participants a sequence starts with and the author retypes them.
     */
    id: "part-sequence-alt",
    layer: 1,
    type: "sequence",
    name: "Alternative",
    description: "sequence · an if / else fragment.",
    icon: "Split",
    // biome-ignore lint/suspicious/noThenProperty: a props bag the allocator reads by key; it is never awaited or returned from async code.
    props: { from: "a", to: "b", when: "when this holds", then: "this", otherwise: "otherwise", orelse: "that" },
    parts: [
      'alt "${when}"',
      { use: "part-sequence-message", props: { indent: "  ", text: "${then}" } },
      'else "${otherwise}"',
      { use: "part-sequence-message", props: { indent: "  ", text: "${orelse}" } },
      "end",
    ],
  },
  {
    id: "part-sequence-loop",
    layer: 1,
    type: "sequence",
    name: "Loop",
    description: "sequence · a repeated fragment.",
    icon: "Repeat",
    props: { from: "a", to: "b", when: "for each one", text: "step" },
    parts: ['loop "${when}"', { use: "part-sequence-message", props: { indent: "  ", text: "${text}" } }, "end"],
  },
  {
    id: "part-timeline-section",
    layer: 1,
    type: "timeline",
    name: "Section",
    description: "timeline · a labelled rule.",
    icon: "Flag",
    source: 'section "${title}"\n${children}',
    props: { title: "A section" },
    parts: [{ use: "part-timeline-moment" }],
  },
  {
    id: "part-gitgraph-branch",
    layer: 1,
    type: "gitgraph",
    name: "Branch",
    description: "gitgraph · a branch with a commit.",
    icon: "GitFork",
    slot: "b",
    source: "branch ${self}\n${children}",
    parts: [{ use: "part-gitgraph-commit", props: { label: "work on ${parent}" } }],
  },
  {
    /*
     * The indent is inside the source, not supplied by a parent, and that is deliberate: this is
     * what a person drops onto a mindmap, and appending is textual, so a branch that arrived at
     * column zero would land as a second root rather than as a branch.
     */
    id: "part-mindmap-branch",
    layer: 1,
    type: "mindmap",
    name: "Branch",
    description: "mindmap · a branch with a leaf.",
    icon: "ListTree",
    source: "  ${title}\n    ${children}",
    props: { title: "A branch" },
    parts: [{ use: "part-mindmap-leaf" }],
  },
];
