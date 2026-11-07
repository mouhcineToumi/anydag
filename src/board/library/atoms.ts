import type { Blueprint } from "./types";

/**
 * Layer 0: one statement of one dialect, introducing at most one id.
 *
 * These are the things nothing else can be broken down into. Every dialect's grammar reduces to six
 * forms — a node, a row, an edge, a container, a directive and a dated entry — and an atom is one
 * of those with the dialect's own kind word in front of it.
 *
 * **A row is never a slot.** `id uuid pk` is a column, and three entities carrying one are three
 * columns called `id`, not a name collision: rows and class members ride as a `rows` / `members`
 * prop inside their node's source, where an allocator cannot see them.
 *
 * **An optional text prop carries its own quotes.** `${?meta}` emits nothing when the prop is
 * empty and ` <value>` when it is not, and in these grammars free text is always quoted — so the
 * value is `"what serves it"`, quotes included. That is what lets one `service` atom draw both
 * `service api "API" "what serves it" icon=server` and `service grp_svc "Service" icon=server`.
 */

const atom = (
  id: string,
  type: Blueprint["type"],
  name: string,
  description: string,
  icon: string,
  source: string,
  props?: Record<string, string>,
  slot?: string,
): Blueprint => ({ id, layer: 0, type, name, description, icon, source, props, slot });

export const ATOMS: Blueprint[] = [
  /* ---- arch ---- */
  atom("part-arch-service", "arch", "Service", "arch · a service card with an icon.", "Server",
    'service ${self} "${title}"${?meta} icon=${icon}${?flags}',
    { title: "Service", meta: '"what runs it"', icon: "server", flags: "" }, "svc"),
  atom("part-arch-store", "arch", "Store", "arch · a database or a bucket.", "Database",
    'store ${self} "${title}"${?meta} icon=${icon}${?flags}',
    { title: "Store", meta: "", icon: "database", flags: "" }, "db"),
  atom("part-arch-queue", "arch", "Queue", "arch · a broker or a bus.", "Radio",
    'queue ${self} "${title}"${?meta} icon=${icon}', { title: "Queue", meta: "", icon: "radio" }, "q"),
  atom("part-arch-client", "arch", "Client", "arch · a browser or an app.", "Monitor",
    'client ${self} "${title}"${?meta} icon=${icon}', { title: "Client", meta: "", icon: "monitor" }, "client"),
  atom("part-arch-person", "arch", "Person", "arch · someone who uses it.", "UserRound",
    'person ${self} "${title}"', { title: "Person" }, "who"),
  atom("part-arch-external", "arch", "External", "arch · a system you do not own.", "Globe",
    'external ${self} "${title}"${?meta} icon=${icon}', { title: "External", meta: "", icon: "globe" }, "ext"),
  atom("part-arch-container", "arch", "Container", "arch · something deploys into it.", "Container",
    'container ${self} "${title}"${?meta} icon=${icon}${?flags}',
    { title: "Container", meta: "", icon: "container", flags: "" }, "ctr"),
  { ...atom("part-arch-row", "arch", "Port row", "arch · a dependency an edge can address.", "Minus",
    '${self} "${text}"', { text: "what it needs" }, "row"), inner: true },

  /* ---- erd ---- */
  atom("part-erd-entity", "erd", "Entity", "erd · a table with a key.", "Table",
    "entity ${self} { ${rows} }", { rows: "id uuid pk; name text; created_at timestamptz" }, "table"),

  /* ---- state ---- */
  atom("part-state-state", "state", "State", "state · one value a field can hold.", "CircleDot",
    'state ${self} "${title}"${?meta}${?flags}', { title: "State", meta: "", flags: "" }, "s"),

  /* ---- flow ---- */
  atom("part-flow-step", "flow", "Step", "flow · one thing that happens.", "Square",
    'step ${self} "${title}"${?meta}${?flags}', { title: "What they do", meta: "", flags: "" }, "step"),
  atom("part-flow-decision", "flow", "Decision", "flow · a question with branches.", "Split",
    'decision ${self} "${title}"', { title: "Is it so?" }, "ask"),

  /* ---- activity ---- */
  atom("part-activity-action", "activity", "Action", "activity · something done.", "Square",
    'action ${self} "${title}"${?meta}${?flags}', { title: "Do the thing", meta: "", flags: "" }, "act"),
  atom("part-activity-decision", "activity", "Decision", "activity · a question with branches.", "Split",
    'decision ${self} "${title}"', { title: "Did it work?" }, "ask"),
  atom("part-activity-fork", "activity", "Fork", "activity · where branches start running at once.", "GitFork",
    "fork ${self}", {}, "f"),
  atom("part-activity-join", "activity", "Join", "activity · where they come back together.", "Merge",
    "join ${self}", {}, "j"),

  /* ---- class ---- */
  atom("part-class-class", "class", "Class", "class · a type with a member.", "Box",
    "class ${self} { ${members} }", { members: "+name: str; +describe() str" }, "Type"),
  atom("part-class-interface", "class", "Interface", "class · a contract.", "Braces",
    "interface ${self} { ${members} }", { members: "+describe() str" }, "Contract"),

  /* ---- usecase ---- */
  atom("part-usecase-actor", "usecase", "Actor", "usecase · someone who comes.", "UserRound",
    'actor ${self} "${title}"${?meta}${?flags}', { title: "Actor", meta: "", flags: "" }, "actor"),
  atom("part-usecase-usecase", "usecase", "Use case", "usecase · what they come for.", "Circle",
    'usecase ${self} "${title}"', { title: "Do the thing" }, "UC-"),

  /* ---- c4 ---- */
  atom("part-c4-container", "c4", "Container", "c4 · a deployable in the system.", "Container",
    'container ${self} "${title}" "${tech}" "${desc}"',
    { title: "Container", tech: "technology", desc: "What it does." }, "ctr"),
  atom("part-c4-person", "c4", "Person", "c4 · a user of the system.", "UserRound",
    'person ${self} "${title}" "${desc}"', { title: "Person", desc: "Uses the system." }, "who"),

  /* ---- sequence ---- */
  atom("part-sequence-participant", "sequence", "Participant", "sequence · a column.", "Milestone",
    'participant ${self} "${title}"${?attrs}', { title: "Participant", attrs: "icon=server" }, "p"),
  /* `indent` because a sequence fragment has no brace to hang one on: `alt` and `loop` indent
     their bodies, and the indentation is the fragment's business rather than the message's. */
  atom("part-sequence-message", "sequence", "Message", "sequence · one call or return.", "MoveRight",
    '${indent}${from} ${arrow} ${to} : "${text}"',
    { indent: "", from: "a", arrow: "->>", to: "b", text: "a message" }),

  /* ---- timeline ---- */
  atom("part-timeline-stretch", "timeline", "Stretch", "timeline · a range with a label.", "CalendarRange",
    '${from} .. ${to} "${title}"${?flags}',
    { from: "2026-01-01", to: "2026-01-31", title: "A stretch of work", flags: "" }),
  atom("part-timeline-moment", "timeline", "Moment", "timeline · a single day.", "Dot",
    '${date} "${title}"${?flags}', { date: "2026-02-01", title: "A moment", flags: "" }),

  /* ---- gitgraph ---- */
  atom("part-gitgraph-commit", "gitgraph", "Commit", "gitgraph · one commit on the current branch.", "GitCommitHorizontal",
    'commit "${label}"', { label: "work" }),

  /* ---- mindmap ---- */
  atom("part-mindmap-leaf", "mindmap", "Leaf", "mindmap · one line under a branch.", "Minus",
    "${text}", { text: "A leaf" }),
];
