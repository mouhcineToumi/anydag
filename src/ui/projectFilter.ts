/*
 * Apart from `Tasks.tsx` so that the pages that hold a filter in their address — Tasks and the
 * Calendar — read it without fetching either page: both are chunks of their own (`src/ui/chunk.ts`).
 */

/**
 * What the Tasks page shows: every task, the tasks under one project's folder — its note's
 * name — or the tasks in no project at all.
 */
export type ProjectFilter = { kind: "all" } | { kind: "none" } | { kind: "project"; name: string };

/** The URL's word for "in no project": not an id, which is ten characters of Crockford base32. */
export const NO_PROJECT = "none";
