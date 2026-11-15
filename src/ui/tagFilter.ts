/*
 * Apart from the pages, as `projectFilter.ts` is, so the pages that hold a tag filter in their
 * address — Tasks and the Calendar — read it without fetching either page's chunk.
 */
import { tagKey } from "@/note/tags";

/**
 * What a page shows by tag (#327): everything, the documents carrying one tag, or those carrying
 * none. One tag at a time, as one project at a time: several would need an *and* or an *or*.
 */
export type TagFilter = { kind: "all" } | { kind: "none" } | { kind: "tag"; name: string };

/** The address's word for "no tag", `tag=none`, as `project=none` is "no project". */
export const NO_TAG = "none";

/** The address's `tag=` as a filter. */
export const tagFilterOf = (param: string | null): TagFilter =>
  !param ? { kind: "all" } : param === NO_TAG ? { kind: "none" } : { kind: "tag", name: param };

/** The filter as the address's `tag=`: `null` takes it out. */
export const tagParam = (filter: TagFilter): string | null =>
  filter.kind === "all" ? null : filter.kind === "none" ? NO_TAG : filter.name;

/** Whether a document carrying `tags` is shown, ignoring case. */
export function tagMatches(filter: TagFilter, tags: readonly string[] | undefined): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "none") return !tags?.length;
  const key = tagKey(filter.name);
  return !!tags?.some((t) => tagKey(t) === key);
}
