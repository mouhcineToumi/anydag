# Critique checklist for the chrome

What to look for in a before/after pair, or in one surface of an audit. It is written for AnyDag's
chrome and points at `DESIGN.md`, which is the standard: where this list and `DESIGN.md` differ,
`DESIGN.md` wins. It covers the same ground as a general design critique and audit (hierarchy,
layout, type, colour, states, consistency, accessibility), narrowed to what a screenshot can show.

Look at the **after** picture first, as a person would, before comparing: does anything look wrong
on its own? Then compare with the **before**, using the diff picture to find every place that moved.
A pixel that moved is not a problem; a pixel that moved for no reason the diff explains might be.

## 1. Hierarchy — does the eye land in the right place?

- One thing on the surface is clearly the most important (a title, a primary action), and it is
  not competing with a second thing of the same weight.
- Headings, labels and secondary text are three distinct levels, not two blurred together.
- A primary button is the only filled accent control in its group (*Controls* in `DESIGN.md`).

## 2. Space and alignment

- Spacing comes from a small set of steps. A new gap that matches none of its neighbours, or two
  sibling gaps that differ by a few pixels, is drift (*Space, corners and elevation*).
- Groups read as groups: the gap *between* groups is clearly larger than the gap *within* one.
  When the two get close, separate things read as one — the most common spacing regression.
- Left edges line up: a label, its field and the row below share an edge. Look for 1–4 px offsets.
- Nothing touches the edge of its card or the window; nothing is clipped or overflows.
- A row's content is vertically centred against its control.

## 3. Type

- Every size is one of the chrome's steps (*Type*); a size in between is drift.
- Weight carries hierarchy, not colour alone; a bold run inside body text is rare.
- Long text wraps where it should and truncates with an ellipsis where it should, not mid-glyph.
- No widows of one short word in a heading or a button.

## 4. Colour and contrast

- Every colour is a role from *Colour roles*: text you must read is `ink` or `slate`, never `muted`;
  words in a role colour use its `…Text` token; `accent` on `accentSoft` is forbidden.
- Text sits on the surface the role table expects; a pair under 4.5:1 (see *Contrast, measured*) is
  a regression unless it is large text, a disabled control or decoration.
- The accent is used for one job at a time (primary, focus, current, link). Accent sprinkled on
  decoration dilutes it.

## 5. States

- The current item, the selected item, a hover, a focus ring, a disabled control and an error each
  look different from the resting state and from each other (*Focus*, *Controls*).
- A focus ring is visible and uses the accent, not a tint (*Focus*).
- An empty state says what is empty and what to do; an error says what went wrong in words
  (*Voice*).

## 6. Dark mode

- Compare the light and dark pictures of the same surface: the same structure, the same hierarchy.
- Nothing is light-only: a white card, a hard-coded shadow, an icon drawn for a light ground.
- Elevation in dark is the theme's shadow, not a grey border that appears only in one theme.

## 7. Consistency across surfaces

- The same control looks the same everywhere: a button, a field, a toggle, a menu, a chip.
- Dialogs share their padding, title size, close button and footer layout (*Dialog*).
- Settings panes share the header with its scope badge, the card with its rows, the row's label and
  hint and control on the right.
- Icons are one family, one stroke weight, one size per context (*Icons*).

## How to write it down

- One finding per problem, with every picture that shows it (light and dark together).
- **Where** (surface and part), **what** (what you see, in px or a ratio), **why it matters**, and
  **the rule** (`DESIGN.md › <section>`).
- `regression` only when this pull request made it worse. Something that was already so is a
  `note` with `"preexisting": true`.
- If nothing is wrong, say so plainly. A review that finds nothing is a useful review.
