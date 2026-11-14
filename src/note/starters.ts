/**
 * The three templates *Add starter templates* writes into an empty templates folder: a meeting, a
 * day, and an architecture decision record.
 *
 * Written only when the person asks, and never over a file that is there. They are ordinary notes
 * — the person edits them, renames them, deletes them — so nothing here is read again after they
 * are written, and a change to this list reaches nobody who already has them.
 *
 * None of them carries a `status:` or a `start:`, so none makes a task or an event on its own: a
 * person who wants that adds the line to their own copy. An ADR's *Status* is a word in the text
 * for the same reason — a `status: accepted` would be no task's status, and `status: todo` a task.
 *
 * No browser, no React, no `@/` aliases: the local server imports this.
 */

export interface Starter {
  /** The file's name inside the templates folder. */
  name: string;
  text: string;
}

export const STARTERS: readonly Starter[] = [
  {
    name: "Meeting",
    text: `---
title: "Meeting {{date}}"
---
**When:** {{date:dddd D MMMM YYYY}}, {{time}}
**Who:**

## Agenda

-

## Notes

## Decisions

## Actions

- [ ]
`,
  },
  {
    name: "Daily",
    text: `---
title: "{{date}}"
---
## {{date:dddd, D MMMM YYYY}}

### Plan

- [ ]

### Done

### Notes
`,
  },
  {
    name: "ADR",
    text: `# {{title}}

**Date:** {{date}}
**Status:** Proposed

## Context

What is the problem, and what forces are at play?

## Decision

What did we decide, in a sentence?

## Consequences

What becomes easier, and what becomes harder?
`,
  },
];
