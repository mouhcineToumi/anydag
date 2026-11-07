import type { Blueprint } from "./types";

/**
 * Layer 3: one whole board item — a note, a starting diagram, a worked starter.
 *
 * The twelve templates are compositions, and that is the payoff of everything below them: the
 * `arch` starter is a client, a service and a store atom with two edges written between them, so
 * the day the service atom gains a default the template has it too. They are also what a new item
 * says before anyone has said anything, which is why `TEMPLATES` is derived from this list rather
 * than kept beside it.
 *
 * **The five worked starters are leaves, on purpose.** `erd-shop`'s value is its column lists and
 * `sequence-auth`'s is its branch labels; spelled as a nested tree of instances they would be four
 * times the punctuation, no longer one statement per line to diff, and still carrying raw DSL in
 * the wiring either way. They carry `madeOf` instead, so the panel can still show what they are
 * built from and hand you the pieces. Composition is a tool here, not an obligation.
 */

const lines = (...l: string[]) => l.join("\n");

const NOTES: Blueprint[] = [
  { id: "note", layer: 3, type: "md", name: "Note", description: "A tinted sticky note.", icon: "StickyNote", attrs: { note: true, w: 320 }, source: "A note." },
  { id: "text", layer: 3, type: "md", name: "Text", description: "Plain markdown, no tint.", icon: "FileText", attrs: { w: 480 }, source: "Some text." },
  { id: "heading", layer: 3, type: "md", name: "Heading", description: "A title and a line under it.", icon: "Heading1", attrs: { w: 560 }, source: lines("# Title", "", "What this board is about, in one sentence.") },
  { id: "table", layer: 3, type: "md", name: "Table", description: "Three columns, two rows.", icon: "Table", attrs: { w: 520 }, source: lines("| name | type | note |", "|---|---|---|", "| first | one | - |", "| second | two | - |") },
  { id: "checklist", layer: 3, type: "md", name: "Checklist", description: "Things to do, ticked in the file.", icon: "ListChecks", attrs: { note: true, w: 360 }, source: lines("**To do**", "", "- [x] The first thing", "- [ ] The next thing", "- [ ] The last thing") },
  { id: "quote", layer: 3, type: "md", name: "Callout", description: "A quoted remark with a source.", icon: "Quote", attrs: { w: 440 }, source: lines("> The thing worth remembering.", ">", "> - who said it") },
  { id: "code", layer: 3, type: "md", name: "Code", description: "A fenced snippet in a note.", icon: "Braces", attrs: { w: 480 }, source: lines("**A snippet**", "", "```ts", "export const answer = 42;", "```") },
  /* Not a note, and not prose: a request waiting to be drawn. It sits here because this list is the
     library's whole items that are not diagrams, and `categoryOf` gives it a section of its own. */
  { id: "prompt", layer: 3, type: "prompt", name: "Describe a diagram", description: "Type what to show; a model draws it here.", icon: "Sparkles", attrs: { w: 420 }, source: "" },
];

/** The smallest diagram of each dialect that draws — composed of the atoms above it. */
const TEMPLATE_DIAGRAMS: Blueprint[] = [
  {
    id: "diagram-arch", layer: 3, type: "arch", name: "arch", description: "A browser, an API and a database.", icon: "Server",
    parts: [
      { use: "part-arch-client", props: { id: "web", title: "Browser" } },
      { use: "part-arch-service", props: { id: "api", title: "API", meta: '"what serves it"' } },
      { use: "part-arch-store", props: { id: "db", title: "Database" } },
      "",
      "web --> api",
      "api --> db",
    ],
  },
  {
    id: "diagram-erd", layer: 3, type: "erd", name: "erd", description: "Two tables and the key between them.", icon: "Database",
    parts: [
      { use: "part-erd-entity", props: { id: "account", rows: "id uuid pk; email text" } },
      { use: "part-erd-entity", props: { id: "order", rows: "id uuid pk; account_id fk; total bigint" } },
      "",
      'account ||--o{ order "account_id"',
    ],
  },
  {
    id: "diagram-state", layer: 3, type: "state", name: "state", description: "Draft to live, and out.", icon: "CircleDot",
    parts: [
      { use: "part-state-state", props: { id: "draft", title: "Draft" } },
      { use: "part-state-state", props: { id: "live", title: "Live", flags: "done" } },
      "",
      "[*] --> draft",
      'draft --> live "publish"',
      "live --> [*]",
    ],
  },
  {
    id: "diagram-flow", layer: 3, type: "flow", name: "flow", description: "Two lanes, three steps.", icon: "Workflow",
    parts: [
      {
        use: "part-flow-lane", props: { id: "person", title: "Person", hue: "ochre" },
        parts: [{ use: "part-flow-step", props: { id: "01", title: "Start here" } }],
      },
      {
        use: "part-flow-lane", props: { id: "system", title: "System", hue: "teal" },
        parts: [
          { use: "part-flow-step", props: { id: "02", title: "Then this happens" } },
          { use: "part-flow-step", props: { id: "03", title: "And it ends", flags: "done" } },
        ],
      },
      "",
      "01 --> 02 --> 03",
    ],
  },
  {
    id: "diagram-activity", layer: 3, type: "activity", name: "activity", description: "An action, a decision, an end.", icon: "Split",
    parts: [
      {
        use: "part-activity-lane", props: { id: "a", title: "Actor", hue: "teal" },
        parts: [
          { use: "part-activity-action", props: { id: "start", title: "Do the first thing" } },
          { use: "part-activity-decision", props: { id: "ok", title: "Did it work?" } },
          { use: "part-activity-action", props: { id: "finish", title: "Wrap up" } },
        ],
      },
      "",
      "[*] --> start --> ok",
      'ok --> finish "yes"',
      "finish --> [*]",
    ],
  },
  {
    id: "diagram-class", layer: 3, type: "class", name: "class", description: "A class and the interface it implements.", icon: "Boxes",
    parts: [
      { use: "part-class-class", props: { id: "Thing" } },
      { use: "part-class-interface", props: { id: "Describable" } },
      "",
      "Thing ..|> Describable",
    ],
  },
  {
    id: "diagram-usecase", layer: 3, type: "usecase", name: "usecase", description: "One actor, one use case.", icon: "Users",
    parts: [
      { use: "part-usecase-actor", props: { id: "user", title: "User" } },
      {
        use: "part-usecase-system", props: { id: "app", title: "The system", hue: "teal" },
        parts: [{ use: "part-usecase-usecase", props: { id: "UC-01", title: "Do the thing" } }],
      },
      "",
      "user --- UC-01",
    ],
  },
  {
    id: "diagram-c4", layer: 3, type: "c4", name: "c4", description: "A person, a system, a container.", icon: "Layers",
    parts: [
      { use: "part-c4-person", props: { id: "user", title: "User" } },
      {
        use: "part-c4-system", props: { id: "app", title: "System", hue: "indigo" },
        parts: [{ use: "part-c4-container", props: { id: "api", title: "API", tech: "your stack", desc: "What it serves." } }],
      },
      "",
      'user --> api "Uses" "HTTPS"',
    ],
  },
  {
    /* Indentation is the whole grammar and there is no id, no edge and nothing to wire: four lines
       that read exactly as their output, and a `madeOf` to say what they are anyway. */
    id: "diagram-mindmap", layer: 3, type: "mindmap", name: "mindmap", description: "A root and two branches.", icon: "Brain",
    madeOf: ["part-mindmap-branch", "part-mindmap-leaf"],
    source: lines("root Topic", "  First branch", "    A leaf", "  Second branch"),
  },
  {
    id: "diagram-sequence", layer: 3, type: "sequence", name: "sequence", description: "A request and its response.", icon: "MessagesSquare",
    parts: [
      { use: "part-sequence-participant", props: { id: "a", title: "Client", attrs: "kind=person" } },
      { use: "part-sequence-participant", props: { id: "b", title: "Service" } },
      "",
      { use: "part-sequence-message", props: { from: "a", to: "b", arrow: "->>", text: "request" } },
      { use: "part-sequence-message", props: { from: "b", to: "a", arrow: "-->>", text: "response" } },
    ],
  },
  {
    id: "diagram-timeline", layer: 3, type: "timeline", name: "timeline", description: "One section, two stretches.", icon: "CalendarRange",
    parts: [
      {
        use: "part-timeline-section", props: { title: "Phase one" },
        parts: [
          { use: "part-timeline-stretch", props: { from: "2026-01-01", to: "2026-01-14", title: "The first thing", flags: "done" } },
          { use: "part-timeline-stretch", props: { from: "2026-01-14", to: "2026-02-01", title: "The next thing" } },
        ],
      },
    ],
  },
  {
    id: "diagram-gitgraph", layer: 3, type: "gitgraph", name: "gitgraph", description: "A branch, merged.", icon: "GitBranch",
    parts: [
      { use: "part-gitgraph-commit", props: { label: "start" } },
      {
        use: "part-gitgraph-branch", props: { id: "feature" },
        parts: [{ use: "part-gitgraph-commit", props: { label: "work" } }],
      },
      "checkout main",
      'merge feature "v1"',
    ],
  },
];

/** Bigger, and written out: the shape of the thing is the point, not the machinery. */
const STARTERS: Blueprint[] = [
  {
    id: "arch-web-app", layer: 3, type: "arch", name: "Web app on a cloud",
    description: "A client, a grouped service tier and its stores.",
    icon: "Cloud", attrs: { title: "What runs where" },
    madeOf: ["part-arch-client", "part-arch-group", "part-arch-service-rows", "part-arch-store", "part-arch-external"],
    source: lines(
      'client web "Browser" "react · vite" icon=monitor',
      "",
      'group cloud "Cloud" hue=indigo {',
      '  service api "API" "fastapi · uvicorn" icon=server {',
      '    auth    "verify the token"',
      '    content "read and write"',
      "  }",
      '  store db "Database" "postgres" icon=database',
      '  store cache "Cache" "redis" icon=database',
      "}",
      'external idp "Identity provider" icon=key-round',
      "",
      'web --> api "https"',
      "api.auth --> idp",
      "api.content --> db",
      "api.content -.-> cache",
    ),
  },
  {
    id: "arch-pipeline", layer: 3, type: "arch", name: "Data pipeline",
    description: "Sources to a warehouse to a dashboard, in one chain.",
    icon: "Route", attrs: { title: "Pipeline", aspect: 0 },
    madeOf: ["part-arch-external", "part-arch-queue", "part-arch-service", "part-arch-store", "part-arch-client"],
    source: lines(
      'external src "Source systems" icon=globe',
      'queue bus "Event bus" icon=radio',
      'service etl "Transform" "batch · hourly" icon=server',
      'store dwh "Warehouse" icon=database',
      'client dash "Dashboard" icon=monitor',
      "",
      "src --> bus --> etl --> dwh --> dash",
    ),
  },
  {
    id: "sequence-auth", layer: 3, type: "sequence", name: "Login sequence",
    description: "A browser, an API and an identity provider, with a branch.",
    icon: "KeyRound", attrs: { title: "Signing in" },
    madeOf: ["part-sequence-participant", "part-sequence-message", "part-sequence-alt"],
    source: lines(
      'participant user "Person" kind=person',
      'participant web "Browser" icon=monitor',
      'participant api "API" icon=server hue=teal',
      'participant idp "Identity" icon=key-round hue=indigo',
      "",
      'user ->> web : "sign in"',
      "web ->> idp : `redirect`",
      "idp -->> web : `code`",
      "web ->> api : `POST /session · code`",
      "activate api",
      "api ->> idp : `exchange`",
      "idp -->> api : `id token`",
      'alt "the token is valid"',
      "  api -->> web : `201 · session`",
      'else "it is not"',
      "  api -->> web : `401`",
      "end",
      "deactivate api",
    ),
  },
  {
    id: "flow-review", layer: 3, type: "flow", name: "Review workflow",
    description: "An author, a reviewer and a loop back.",
    icon: "Repeat", attrs: { title: "Review" },
    madeOf: ["part-flow-lane", "part-flow-step", "part-flow-decision"],
    source: lines(
      'lane author "Author" hue=ochre {',
      '  step 01 "Open a change"',
      '  step 03 "Address the notes" wait',
      "}",
      'lane reviewer "Reviewer" hue=teal {',
      '  decision 02 "Approve?"',
      '  step 04 "Merge" done',
      "}",
      "",
      "01 --> 02",
      '02 --> 03 "no"',
      "03 --> 02",
      '02 --> 04 "yes"',
    ),
  },
  {
    id: "erd-shop", layer: 3, type: "erd", name: "Shop schema",
    description: "Customers, orders and lines, in two domains.",
    icon: "Package", attrs: { title: "Shop" },
    madeOf: ["part-erd-entity"],
    source: lines(
      'group people "People" hue=indigo {',
      "  entity customer { id uuid pk; email text; name text }",
      "}",
      'group sales "Sales" hue=coral {',
      "  entity order { id uuid pk; customer_id fk=people; placed_at timestamptz; total bigint }",
      "  entity order_line { id uuid pk; order_id fk=sales; sku text; qty int }",
      "}",
      "",
      'customer ||--o{ order "customer_id"',
      'order ||--|{ order_line "order_id"',
    ),
  },
];

export const DIAGRAMS: Blueprint[] = [...NOTES, ...TEMPLATE_DIAGRAMS, ...STARTERS];
export const TEMPLATE_IDS = TEMPLATE_DIAGRAMS.map((d) => d.id);
