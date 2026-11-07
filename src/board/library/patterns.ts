import type { Blueprint } from "./types";

/**
 * Layer 2: several atoms and molecules, wired together — the idioms.
 *
 * This is the layer the flat library had no room for. A three-tier stack, a request and its
 * return, a one-to-many reference, an approval that loops back: each is a thing people draw over
 * and over, and each was previously either typed out again or approximated by dropping three parts
 * and writing the edges by hand.
 *
 * A pattern is still a **fragment** — it joins a diagram of its own type — so every id it brings is
 * allocated clear of what is already there, and dropping the same pattern twice gives two of it
 * rather than a pile of duplicate-id errors. `as` names the instances so the wiring can say
 * `${api}` and get whatever id that instance was actually given.
 */

export const PATTERNS: Blueprint[] = [
  {
    id: "pattern-arch-three-tier",
    layer: 2,
    type: "arch",
    name: "Three tier",
    description: "arch · a client, the service it calls, the store behind it.",
    icon: "Layers",
    parts: [
      { use: "part-arch-client", as: "ui", props: { title: "Browser" } },
      { use: "part-arch-service", as: "api", props: { title: "API", meta: '"what serves it"' } },
      { use: "part-arch-store", as: "store", props: { title: "Database" } },
      "",
      "${ui} --> ${api}",
      "${api} --> ${store}",
    ],
  },
  {
    id: "pattern-arch-cache-aside",
    layer: 2,
    type: "arch",
    name: "Cache aside",
    description: "arch · a service reading through a cache to its store.",
    icon: "Database",
    parts: [
      { use: "part-arch-service", as: "api", props: { title: "Service", meta: "" } },
      { use: "part-arch-store", as: "cache", props: { title: "Cache", meta: '"redis"' } },
      { use: "part-arch-store", as: "store", props: { title: "Database", meta: '"postgres"' } },
      "",
      '${api} -.-> ${cache} "read through"',
      "${api} --> ${store}",
    ],
  },
  {
    id: "pattern-erd-one-to-many",
    layer: 2,
    type: "erd",
    name: "One to many",
    description: "erd · a parent table, its children, and the key between them.",
    icon: "Table",
    parts: [
      { use: "part-erd-entity", as: "one", props: { rows: "id uuid pk; name text" } },
      { use: "part-erd-entity", as: "many", props: { rows: "id uuid pk; parent_id fk; created_at timestamptz" } },
      "",
      '${one} ||--o{ ${many} "parent_id"',
    ],
  },
  {
    id: "pattern-state-retry",
    layer: 2,
    type: "state",
    name: "Retry and give up",
    description: "state · a waiting state that loops, settles or fails.",
    icon: "Repeat",
    parts: [
      { use: "part-state-state", as: "wait", props: { title: "Waiting", flags: "wait" } },
      { use: "part-state-state", as: "done", props: { title: "Done", flags: "done" } },
      { use: "part-state-state", as: "failed", props: { title: "Failed", flags: "stop" } },
      "",
      '${wait} --> ${wait} "retry"',
      '${wait} --> ${done} "it worked"',
      '${wait} --> ${failed} "gave up"',
    ],
  },
  {
    id: "pattern-flow-approval",
    layer: 2,
    type: "flow",
    name: "Approval loop",
    description: "flow · a decision that sends the work back until it passes.",
    icon: "Workflow",
    parts: [
      {
        use: "part-flow-lane",
        props: { title: "Reviewer", hue: "teal" },
        parts: [
          { use: "part-flow-step", as: "send", props: { title: "Send for approval" } },
          { use: "part-flow-decision", as: "ok", props: { title: "Approved?" } },
          { use: "part-flow-step", as: "fix", props: { title: "Address the notes", flags: "wait" } },
          { use: "part-flow-step", as: "ship", props: { title: "Publish", flags: "done" } },
        ],
      },
      "",
      "${send} --> ${ok}",
      '${ok} --> ${fix} "no"',
      "${fix} --> ${ok}",
      '${ok} --> ${ship} "yes"',
    ],
  },
  {
    id: "pattern-activity-fork-join",
    layer: 2,
    type: "activity",
    name: "Fork and join",
    description: "activity · two things happening at once, and the wait for both.",
    icon: "Split",
    parts: [
      {
        use: "part-activity-lane",
        props: { title: "System", hue: "teal" },
        parts: [
          { use: "part-activity-fork", as: "fork" },
          { use: "part-activity-action", as: "left", props: { title: "Render the HTML" } },
          { use: "part-activity-action", as: "right", props: { title: "Render the PDF" } },
          { use: "part-activity-join", as: "join" },
        ],
      },
      "",
      "${fork} --> ${left} & ${right}",
      "${left} & ${right} --> ${join}",
    ],
  },
  {
    id: "pattern-class-implements",
    layer: 2,
    type: "class",
    name: "Implements",
    description: "class · a contract and the type that satisfies it.",
    icon: "Boxes",
    parts: [
      { use: "part-class-interface", as: "contract", props: { members: "+describe() str" } },
      { use: "part-class-class", as: "impl", props: { members: "-name: str; +describe() str" } },
      "",
      "${impl} ..|> ${contract}",
    ],
  },
  {
    id: "pattern-usecase-include",
    layer: 2,
    type: "usecase",
    name: "Include",
    description: "usecase · a use case that always pulls in another.",
    icon: "Users",
    parts: [
      { use: "part-usecase-actor", as: "who", props: { title: "Actor" } },
      { use: "part-usecase-usecase", as: "main", props: { title: "Do the thing" } },
      { use: "part-usecase-usecase", as: "shared", props: { title: "The shared step" } },
      "",
      "${who} --- ${main}",
      '${main} -.-> ${shared} "«include»"',
    ],
  },
  {
    id: "pattern-c4-uses",
    layer: 2,
    type: "c4",
    name: "Person uses a container",
    description: "c4 · someone, something they use, and how.",
    icon: "Container",
    parts: [
      { use: "part-c4-person", as: "who", props: { title: "User" } },
      { use: "part-c4-container", as: "app", props: { title: "API", tech: "your stack", desc: "Serves the app." } },
      "",
      '${who} --> ${app} "Uses" "HTTPS"',
    ],
  },
  {
    id: "pattern-sequence-exchange",
    layer: 2,
    type: "sequence",
    name: "Request and response",
    description: "sequence · a call, the busy bar, and the return.",
    icon: "MessagesSquare",
    props: { from: "a", to: "b", ask: "request", answer: "response" },
    parts: [
      { use: "part-sequence-message", props: { text: "${ask}" } },
      "activate ${to}",
      { use: "part-sequence-message", props: { from: "${to}", to: "${from}", arrow: "-->>", text: "${answer}" } },
      "deactivate ${to}",
    ],
  },
  {
    /* Self-closing: it ends where it started, so two of them are two branches off `main` rather
       than one branched off the other. That is what a stream dialect asks of a fragment. */
    id: "pattern-gitgraph-feature",
    layer: 2,
    type: "gitgraph",
    name: "Feature branch",
    description: "gitgraph · a branch, two commits, and the merge back.",
    icon: "GitBranch",
    parts: [
      {
        use: "part-gitgraph-branch",
        as: "feature",
        parts: [
          { use: "part-gitgraph-commit", props: { label: "the first part" } },
          { use: "part-gitgraph-commit", props: { label: "the rest of it" } },
        ],
      },
      "checkout main",
      'merge ${feature} "shipped"',
    ],
  },
];
