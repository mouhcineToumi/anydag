/**
 * "Did you mean" for the closed vocabularies.
 *
 * A diagnostic that names what is wrong without naming what is right is only half an error message.
 * `unknown id \`database\`` is true, and it leaves the reader — a person or an agent — to go and
 * find the eight words that would have worked. The vocabulary is small and known at the point the
 * error is raised, so there is no reason not to say it.
 *
 * Two mechanisms, because the mistakes come in two shapes and edit distance only catches one:
 *
 * - **Typos** are close in spelling. `serivce` is two edits from `service`, and `nearest()` finds
 *   it.
 * - **Wrong synonyms** are close in meaning and nowhere near in spelling. `database` is *six*
 *   edits from `db` — further from the right answer than from every wrong one — so no distance
 *   threshold that admits it would reject anything. Those need a table, and `ALIASES` is it.
 *
 * The second kind is the common one when the author is a language model: it does not typo, it
 * reaches for the word the rest of the industry uses. Every entry below is a word that would be
 * unremarkable in any other diagramming tool.
 */

/** Levenshtein, with an early exit once the row's best is already past the budget. */
function distance(a: string, b: string, budget: number): number {
  if (Math.abs(a.length - b.length) > budget) return budget + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(d);
      if (d < best) best = d;
    }
    if (best > budget) return budget + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * The closest candidate, or nothing when none is close enough to be worth saying.
 *
 * The budget grows with the word because one edit in three letters is a different word and one
 * edit in twelve is a slip of the finger.
 */
export function nearest(word: string, candidates: Iterable<string>): string | undefined {
  const w = word.toLowerCase();
  const budget = Math.max(1, Math.floor(w.length / 3));
  let best: string | undefined;
  let bestD = budget + 1;
  for (const c of candidates) {
    const d = distance(w, c.toLowerCase(), budget);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= budget ? best : undefined;
}

/**
 * The word the rest of the world uses → the word this DSL uses.
 *
 * Only consulted when the dialect actually has the kind on the right, so one table serves every
 * dialect: `store` is arch's and C4's, `entity` is the ERD's, and asking for `table` in an
 * architecture diagram correctly gets no suggestion rather than a wrong one.
 */
const ALIASES: Record<string, string> = {
  /* → db */
  database: "db",
  databases: "db",
  postgres: "db",
  postgresql: "db",
  mysql: "db",
  sql: "db",
  rds: "db",
  datastore: "db",
  table: "entity",
  tables: "entity",

  /* → store */
  storage: "store",
  bucket: "store",
  blob: "store",
  s3: "store",
  cache: "store",
  redis: "store",
  index: "store",
  volume: "store",

  /* → service */
  api: "service",
  app: "service",
  application: "service",
  backend: "service",
  server: "service",
  component: "service",
  microservice: "service",
  function: "service",
  lambda: "service",
  worker: "service",
  job: "service",
  process: "service",

  /* → client */
  browser: "client",
  frontend: "client",
  ui: "client",
  spa: "client",
  web: "client",
  mobile: "client",

  /* → person */
  user: "person",
  users: "person",
  human: "person",
  customer: "person",
  admin: "person",
  role: "actor",

  /* → queue */
  topic: "queue",
  broker: "queue",
  stream: "queue",
  kafka: "queue",
  bus: "queue",
  mq: "queue",
  pubsub: "queue",

  /* → external */
  thirdparty: "external",
  "third-party": "external",
  vendor: "external",
  saas: "external",
  extern: "external",

  /* → container */
  pod: "container",
  docker: "container",
  image: "container",

  /* → entity */
  model: "entity",
  record: "entity",
  schema: "entity",
  collection: "entity",

  /* → step / action */
  task: "step",
  activity: "step",
  stage: "step",
  operation: "step",
  branch: "decision",
  condition: "decision",
  choice: "decision",
  gateway: "decision",
  "if": "decision",

  /* → class */
  type: "class",
  struct: "class",
  object: "class",
  record_type: "class",
  protocol: "interface",
  trait: "interface",

  /* → usecase */
  "use-case": "usecase",
  goal: "usecase",
  feature: "usecase",

  /* → the chart vocabulary. Every one of these is what another charting library calls the thing:
     a column chart is a bar chart stood up, an area chart is a filled line, a ring chart is a
     donut, and `label`/`data` are what a spreadsheet calls the two axes of a series. */
  column: "bar",
  area: "line",
  ring: "donut",
  label: "x",
  data: "series",

  /* → the sketch shapes. `rectangle` is the word every drawing tool has for what this one calls a
     box, and none of these is a typo for the word it maps to — `rhombus` is nine edits from
     `diamond`. Consulted only where the dialect has the target, so they are `sketch`'s alone. */
  rectangle: "box",
  rect: "box",
  square: "box",
  oval: "ellipse",
  rhombus: "diamond",
  pill: "stadium",
  capsule: "stadium",
  doc: "document",
  bubble: "callout",
  speech: "callout",
  balloon: "callout",
  drum: "cylinder",

  /* → ink. The words the pen goes by everywhere else — a model told to "draw this freehand"
     writes `pen` or `stroke`, and none of them is a typo for `ink`, they are the industry's word
     for the same mark. Consulted only where the dialect has the target, so they are `sketch`'s
     alone. */
  pen: "ink",
  pencil: "ink",
  stroke: "ink",
  scribble: "ink",
  draw: "ink",
  freehand: "ink",
};

/** Whether a word is one the synonym table answers — a kind the author meant, not a typo of one. */
export const isKindAlias = (word: string): boolean => word.toLowerCase() in ALIASES;

/**
 * The picture a word names, for a dialect that can draw one (`sketch`'s `figure`).
 *
 * `house h "Home"` in a sketch is not a typo for a kind — it is somebody asking for a house, which
 * is a `figure` wearing `icon=emoji:house`, and the vocabulary that holds the answer is the icon
 * one, fifteen hundred names deep. So the answer is looked up rather than guessed at: the emoji of
 * that exact name first (the illustration a person means), then a short table of the words that are
 * nobody's name for the picture they mean — `home` is Unicode's `house`, `book` is five books and
 * none of them `book` — and last any icon of that exact name (a `server` is Lucide's server).
 * No edit distance: a near miss over four thousand names would hand back a word nobody wrote.
 *
 * `""` means the figure's own default, the stick figure, which needs no `icon=` at all.
 */
const PICTURE_ALIASES: Record<string, string> = {
  stickman: "",
  "stick-man": "",
  "stick-figure": "",
  stickfigure: "",
  home: "emoji:house",
  building: "emoji:office-building",
  office: "emoji:office-building",
  book: "emoji:closed-book",
  people: "emoji:busts-in-silhouette",
  team: "emoji:busts-in-silhouette",
  group: "emoji:busts-in-silhouette",
  user: "emoji:bust-in-silhouette",
  customer: "emoji:bust-in-silhouette",
  car: "emoji:automobile",
  truck: "emoji:delivery-truck",
  tree: "emoji:deciduous-tree",
  phone: "emoji:mobile-phone",
  computer: "emoji:desktop-computer",
  money: "emoji:money-bag",
  shop: "emoji:convenience-store",
  store: "emoji:convenience-store",
  rain: "emoji:cloud-with-rain",
  email: "emoji:envelope",
  mail: "emoji:envelope",
  letter: "emoji:envelope",
  globe: "emoji:globe-with-meridians",
  world: "emoji:globe-with-meridians",
  internet: "emoji:globe-with-meridians",
  map: "emoji:world-map",
  clock: "emoji:alarm-clock",
  lock: "emoji:locked",
  idea: "emoji:light-bulb",
  bulb: "emoji:light-bulb",
  plane: "emoji:airplane",
  bike: "emoji:bicycle",
  boat: "emoji:sailboat",
  heart: "emoji:red-heart",
  check: "emoji:check-mark-button",
  cross: "emoji:cross-mark",
  question: "emoji:red-question-mark",
};

export function suggestPicture(word: string, names: ReadonlySet<string>): string | undefined {
  const w = word.toLowerCase();
  if (names.has(`emoji:${w}`)) return `emoji:${w}`;
  const alias = PICTURE_ALIASES[w];
  if (alias === "" || (alias !== undefined && names.has(alias))) return alias;
  if (names.has(w)) return w;
  return undefined;
}

/**
 * The kind an author probably meant, given what this dialect offers.
 *
 * A dialect with one kind always suggests it: there is exactly one right answer and no reason to
 * make anyone guess it. `erd` and `state` are both in that position, and "`table` is not a kind in
 * erd — did you mean `entity`?" is the entire fix.
 */
export function suggestKind(word: string, kinds: readonly string[]): string | undefined {
  if (kinds.length === 1) return kinds[0];
  const alias = ALIASES[word.toLowerCase()];
  if (alias && kinds.includes(alias)) return alias;
  return nearest(word, kinds);
}

/**
 * The generic colour word an author reaches for → the ten names `HUE_ORDER` actually has.
 *
 * Same shape as `ALIASES`, and for the same reason: `purple` is not a typo for `violet`, it is the
 * word every other tool uses, and no edit-distance budget that admitted it would reject `bronze` or
 * `crimson`. Deliberately silent on `gray`/`grey` — none of the ten is a grey, and guessing one
 * would be worse than naming the closed set and letting the author pick.
 */
const HUE_ALIASES: Record<string, string> = {
  purple: "violet",
  blue: "indigo",
  yellow: "ochre",
  orange: "bronze",
  red: "crimson",
  pink: "magenta",
  green: "moss",
};

/** The hue an author probably meant, given the ten `HUE_ORDER` actually has. */
export function suggestHue(word: string, hues: readonly string[]): string | undefined {
  const alias = HUE_ALIASES[word.toLowerCase()];
  if (alias && hues.includes(alias)) return alias;
  return nearest(word, hues);
}

/**
 * The icon name an author probably meant → the one the generated set actually accepts.
 *
 * The icon vocabulary is a different shape from the kind vocabulary — ~2,900 names, three
 * collections — but the mistakes that matter are still the two the doc comment above names, plus
 * two more that edit distance cannot reach at all:
 *
 * - **Abbreviations**. `js`, `ts`, `py` are what the industry writes, and a two-letter word has a
 *   one-edit budget — too small for `javascript` and exactly big enough to land on `pg`, another
 *   company's mark, if the table did not answer first.
 * - **Vendor namespaces**. The cloud packs are named `aws:lambda` and `gcp:bigquery`, and a model
 *   writes the service's own word alone — four edits of prefix that no length-scaled budget
 *   reaches.
 *
 * Each entry is checked against the set before it is returned, so an entry that stops being true —
 * a vendor renames a slug, the build drops a pack — degrades to edit distance instead of
 * suggesting a name nothing draws.
 */
const ICON_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  golang: "go",
  lambda: "aws:lambda",
  s3: "aws:s3",
  bigquery: "gcp:bigquery",
};

/**
 * The icon an author probably meant, given the names `icon=` accepts.
 *
 * The word may arrive with a `mono:` or `lucide:` prefix on it — the same two every reader of this
 * value strips — and it is carried back on the suggestion, so what the diagnostic names can be
 * pasted into the line it came from unchanged. One honesty about that: under `mono:` the nearest
 * name may be a concept glyph the prefix then cannot draw, and under either prefix a vendor slug
 * like `aws:lambda` only exists unprefixed. A suggestion is advisory — the author picks, and the
 * diagnostic has done its job by naming the near miss.
 */
export function suggestIcon(word: string, names: Iterable<string>): string | undefined {
  const prefix = ["mono:", "lucide:"].find((p) => word.startsWith(p));
  const bare = prefix ? word.slice(prefix.length) : word;
  const alias = ICON_ALIASES[bare.toLowerCase()];
  if (alias) {
    const set = names instanceof Set ? names : new Set(names);
    if (set.has(alias)) return prefix ? prefix + alias : alias;
  }
  const guess = nearest(bare, names);
  return guess ? (prefix ? prefix + guess : guess) : undefined;
}
