import { EMOJI_CATEGORIES } from "../../dsl/emoji-names";
import type { Blueprint } from "./types";

/**
 * The Objects section: pictures to illustrate with — a person, a house, a book, a truck.
 *
 * Every other section of the library is a statement about a system or a shape to draw with. These
 * are the things a person draws *about*: somebody explaining how an order reaches a warehouse wants
 * a customer, a phone, a parcel and a truck, and a box with the word "truck" in it is the diagram
 * apologising for not having one. Each entry is one `figure` — a picture with a caption under it —
 * wearing a different `icon=`, so the whole section is one atom's worth of grammar and fifteen
 * hundred pictures' worth of vocabulary.
 *
 * **Three kinds of shelf.** *Drawn* is Lucide's line glyphs, in the ink or the hue — the whiteboard's
 * own register, with the stick figure first because that is the one thing everybody reaching for a
 * person on a whiteboard means. *Essentials* is the emoji a diagram needs most, picked by hand so the
 * house and the laptop are not on page nine of "Travel & Places". Then **every other emoji**, on its
 * category's shelf, because "as many as possible to cover most things a user could need" is the
 * brief, and a set that covers a kangaroo and a stethoscope is the only honest answer to it.
 *
 * Each picture is on exactly one shelf, so a search never answers with the same emoji twice. The
 * caption a figure arrives with is the picture's name; it is the easiest thing in the world to change
 * — a double-click types over it, and an empty one takes it off — and a caption that is already
 * there is how a person learns there is one.
 *
 * Generated rather than written out for the emoji, from `src/dsl/emoji-names.ts` (itself generated
 * from the set): fifteen hundred hand-written entries would be fifteen hundred chances to name a
 * picture the set does not have, and `test/library.test.ts` would find every one of them anyway.
 */

/** The shelves, in the order the panel shows them. */
export const SHELVES = [
  "Drawn",
  "Essentials",
  "People",
  "Places & travel",
  "Things",
  "Nature",
  "Food & drink",
  "Activities",
  "Faces & feelings",
  "Symbols",
] as const;

type Shelf = (typeof SHELVES)[number];

/** Fluent's own categories → the shelf a person looks on. The flags are eight and join the symbols. */
const SHELF_OF: Record<string, Shelf> = {
  "People & Body": "People",
  "Travel & Places": "Places & travel",
  Objects: "Things",
  "Animals & Nature": "Nature",
  "Food & Drink": "Food & drink",
  Activities: "Activities",
  "Smileys & Emotion": "Faces & feelings",
  Symbols: "Symbols",
  Flags: "Symbols",
};

/** A picture's name as a person says it: `man-technologist` is "Man technologist". */
const spoken = (slug: string): string => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The id a dropped figure is numbered from — the picture's name, at most three words of it. */
const slotOf = (slug: string): string => slug.split("-").slice(0, 3).join("-");

const figure = (id: string, name: string, picture: string, shelf: Shelf, description: string): Blueprint => ({
  id,
  layer: 0,
  type: "sketch",
  name,
  description,
  icon: "Image",
  shelf,
  picture,
  source: picture ? `figure \${self} "\${title}" icon=${picture}\${?at}` : 'figure ${self} "${title}"${?at}',
  props: { title: name, at: "" },
  slot: picture ? slotOf(picture.replace(/^(?:lucide|mono):/, "").replace(/^emoji:/, "")) : "person",
});

/**
 * Lucide's line glyphs, drawn big. `[icon, name]` — the icon exactly as a line would say it, so the
 * one Lucide name a brand also claims (`snowflake`) carries its `lucide:` here.
 */
const DRAWN: [string, string][] = [
  ["", "Stick figure"],
  ["user", "Person"],
  ["users", "People"],
  ["baby", "Baby"],
  ["handshake", "Handshake"],
  ["hand", "Hand"],
  ["thumbs-up", "Thumbs up"],
  ["smile", "Smile"],
  ["brain", "Brain"],
  ["eye", "Eye"],
  ["house", "House"],
  ["building", "Building"],
  ["building2", "Office"],
  ["factory", "Factory"],
  ["warehouse", "Warehouse"],
  ["store", "Shop"],
  ["landmark", "Bank"],
  ["school", "School"],
  ["hospital", "Hospital"],
  ["hotel", "Hotel"],
  ["church", "Church"],
  ["castle", "Castle"],
  ["tent", "Tent"],
  ["mountain", "Mountain"],
  ["laptop", "Laptop"],
  ["smartphone", "Smartphone"],
  ["monitor", "Screen"],
  ["tablet", "Tablet"],
  ["server", "Server"],
  ["database", "Database"],
  ["hard-drive", "Hard drive"],
  ["cpu", "Chip"],
  ["router", "Router"],
  ["wifi", "Wi-Fi"],
  ["cloud", "Cloud"],
  ["globe", "Globe"],
  ["book", "Book"],
  ["book-open", "Open book"],
  ["library", "Library"],
  ["notebook", "Notebook"],
  ["newspaper", "Newspaper"],
  ["file-text", "Document"],
  ["folder", "Folder"],
  ["clipboard", "Clipboard"],
  ["mail", "Letter"],
  ["message-circle", "Message"],
  ["phone", "Phone"],
  ["megaphone", "Megaphone"],
  ["presentation", "Presentation"],
  ["calendar", "Calendar"],
  ["clock", "Clock"],
  ["hourglass", "Hourglass"],
  ["lightbulb", "Idea"],
  ["lock", "Lock"],
  ["key", "Key"],
  ["shield", "Shield"],
  ["bell", "Bell"],
  ["settings", "Gear"],
  ["wrench", "Wrench"],
  ["hammer", "Hammer"],
  ["pencil", "Pencil"],
  ["scissors", "Scissors"],
  ["briefcase", "Briefcase"],
  ["package", "Parcel"],
  ["gift", "Gift"],
  ["ticket", "Ticket"],
  ["shopping-cart", "Cart"],
  ["shopping-bag", "Bag"],
  ["credit-card", "Card"],
  ["wallet", "Wallet"],
  ["coins", "Coins"],
  ["banknote", "Cash"],
  ["piggy-bank", "Savings"],
  ["scale", "Scales"],
  ["gavel", "Gavel"],
  ["trending-up", "Growth"],
  ["gauge", "Gauge"],
  ["target", "Target"],
  ["puzzle", "Puzzle"],
  ["trophy", "Trophy"],
  ["award", "Award"],
  ["crown", "Crown"],
  ["gem", "Gem"],
  ["flag", "Flag"],
  ["heart", "Heart"],
  ["star", "Star"],
  ["sparkles", "Sparkles"],
  ["graduation-cap", "Graduation"],
  ["stethoscope", "Stethoscope"],
  ["pill", "Pill"],
  ["syringe", "Syringe"],
  ["camera", "Camera"],
  ["film", "Film"],
  ["tv", "Television"],
  ["music", "Music"],
  ["headphones", "Headphones"],
  ["coffee", "Coffee"],
  ["utensils", "Meal"],
  ["bed", "Bed"],
  ["sofa", "Sofa"],
  ["car", "Car"],
  ["truck", "Truck"],
  ["bus", "Bus"],
  ["train-front", "Train"],
  ["plane", "Plane"],
  ["ship", "Ship"],
  ["bike", "Bicycle"],
  ["rocket", "Rocket"],
  ["anchor", "Anchor"],
  ["map", "Map"],
  ["map-pin", "Pin"],
  ["compass", "Compass"],
  ["tree-deciduous", "Tree"],
  ["tree-pine", "Pine"],
  ["trees", "Forest"],
  ["flower", "Flower"],
  ["leaf", "Leaf"],
  ["sun", "Sun"],
  ["moon", "Moon"],
  ["cloud-rain", "Rain"],
  ["lucide:snowflake", "Snow"],
  ["umbrella", "Umbrella"],
  ["zap", "Lightning"],
  ["flame", "Fire"],
  ["droplet", "Water"],
  ["dog", "Dog"],
  ["cat", "Cat"],
  ["bird", "Bird"],
  ["fish", "Fish"],
  ["bug", "Bug"],
  ["paw-print", "Paw"],
];

/**
 * The emoji a diagram reaches for most, first — by hand, in the order a story about a system tends
 * to need them: who, where, with what, carrying what, and how it went.
 */
const ESSENTIALS = [
  "person",
  "man",
  "woman",
  "office-worker",
  "man-technologist",
  "woman-technologist",
  "busts-in-silhouette",
  "people-hugging",
  "robot",
  "house",
  "office-building",
  "factory",
  "convenience-store",
  "bank",
  "school",
  "hospital",
  "classical-building",
  "desktop-computer",
  "laptop",
  "mobile-phone",
  "closed-book",
  "books",
  "memo",
  "page-facing-up",
  "file-folder",
  "envelope",
  "speech-balloon",
  "package",
  "delivery-truck",
  "automobile",
  "airplane",
  "globe-with-meridians",
  "world-map",
  "money-bag",
  "credit-card",
  "shopping-cart",
  "chart-increasing",
  "bar-chart",
  "light-bulb",
  "gear",
  "hammer-and-wrench",
  "magnifying-glass-tilted-left",
  "locked",
  "key",
  "calendar",
  "alarm-clock",
  "hourglass-done",
  "rocket",
  "trophy",
  "handshake",
  "thumbs-up",
  "red-heart",
  "thinking-face",
  "deciduous-tree",
  "cloud",
  "sun",
  "fire",
  "warning",
  "check-mark-button",
  "cross-mark",
  "red-question-mark",
];

const emojiEntry = (slug: string, shelf: Shelf): Blueprint =>
  figure(`object-${slug}`, spoken(slug), `emoji:${slug}`, shelf, `emoji · ${shelf.toLowerCase()}`);

const essential = new Set(ESSENTIALS);

export const OBJECTS: Blueprint[] = [
  ...DRAWN.map(([icon, name]) =>
    figure(
      `object-line-${icon ? icon.replace(/^lucide:/, "") : "stick-figure"}`,
      name,
      icon,
      "Drawn",
      icon ? "drawn · a line picture, in the ink or its hue" : "drawn · a stick figure, which a figure is by default",
    ),
  ),
  ...ESSENTIALS.map((slug) => emojiEntry(slug, "Essentials")),
  ...EMOJI_CATEGORIES.flatMap((c) =>
    c.icons.filter((slug) => !essential.has(slug)).map((slug) => emojiEntry(slug, SHELF_OF[c.name] ?? "Symbols")),
  ).sort((a, b) => SHELVES.indexOf(a.shelf as Shelf) - SHELVES.indexOf(b.shelf as Shelf)),
];
