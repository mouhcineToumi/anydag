/**
 * An attachment's icon — one per sort, so a PDF, a spreadsheet and a video are told apart at a
 * glance in the sidebar, the search, a picker and on a card.
 *
 * An explicit map rather than a lookup by name, for the reason the library's is: a bundler cannot
 * see through a name looked up at runtime, and twelve hundred glyphs are not what a row needs.
 */
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FilePenLine,
  FileSpreadsheet,
  FileType2,
  FileVideo,
  Presentation,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

import { sortOf, type FileSort } from "./types";

export const SORT_ICON: Readonly<Record<FileSort, LucideIcon>> = {
  pdf: FileType2,
  image: FileImage,
  doc: FilePenLine,
  sheet: FileSpreadsheet,
  slide: Presentation,
  audio: FileAudio,
  video: FileVideo,
  archive: FileArchive,
  text: FileCode,
  other: File,
};

/** The icon for a file by its name. */
export function FileIcon({ name, ...rest }: { name: string } & LucideProps) {
  const sort = sortOf(name);
  const Icon = SORT_ICON[sort];
  return <Icon data-dag-file-sort={sort} aria-hidden="true" {...rest} />;
}
