import type { ComponentType } from "react";

import { chunk, useChunk, type Chunk } from "./chunk";

/**
 * The pages, cards and panels a board never draws, each a chunk of its own (`chunk.ts` says why, and why
 * not `React.lazy`). Each export takes the props of the component it stands for and draws it once
 * its chunk has come — nothing until then, which on a click is the few milliseconds a local server
 * takes, and usually nothing at all: every chunk is fetched once the first page is ready.
 *
 * `App.tsx` and `Shell.tsx` import these in place of the modules, so it names each module only here, behind an
 * `import()`. A component picked from a module is the module's own export, the same one on every
 * render, so a page under it never remounts.
 */
function part<M, P extends object>(of: Chunk<M>, pick: (m: M) => ComponentType<P>, name: string): ComponentType<P> {
  function Part(props: P) {
    const m = useChunk(of);
    if (!m) return null;
    const Drawn = pick(m);
    return <Drawn {...props} />;
  }
  Part.displayName = name;
  return Part;
}

const settings = chunk(() => import("@/settings/Settings"));
const feedback = chunk(() => import("@/feedback/FeedbackCard"));
const search = chunk(() => import("./BoardBrowser"));
const calendar = chunk(() => import("./Calendar"));
const tasks = chunk(() => import("./Tasks"));
const trash = chunk(() => import("./Trash"));
const assistant = chunk(() => import("@/assistant/Page"));
const assistantPanel = chunk(() => import("@/assistant/Panel"));
const table = chunk(() => import("./table/TablePage"));
const quizEditor = chunk(() => import("./quiz/Editor"));
const quizzes = chunk(() => import("./quiz/Gallery"));

export const Settings = part(settings, (m) => m.Settings, "Settings");
export const FeedbackCard = part(feedback, (m) => m.FeedbackCard, "FeedbackCard");
export const BoardBrowser = part(search, (m) => m.BoardBrowser, "BoardBrowser");
export const CalendarView = part(calendar, (m) => m.CalendarView, "CalendarView");
export const TasksView = part(tasks, (m) => m.TasksView, "TasksView");
export const LayoutToggle = part(tasks, (m) => m.LayoutToggle, "LayoutToggle");
export const TrashView = part(trash, (m) => m.TrashView, "TrashView");
export const AssistantView = part(assistant, (m) => m.AssistantView, "AssistantView");
export const AssistantPanel = part(assistantPanel, (m) => m.AssistantPanel, "AssistantPanel");
export const TablePage = part(table, (m) => m.TablePage, "TablePage");
export const QuizEditor = part(quizEditor, (m) => m.QuizEditor, "QuizEditor");
export const QuizzesView = part(quizzes, (m) => m.QuizzesView, "QuizzesView");
