import { GraduationCap, Play, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";

import type { BoardTree } from "@/board/useBoard";
import { folderQuizzes } from "@/quiz/folder";

import type { Practice } from "./practice";

/**
 * The Quizzes page: every quiz as a card, and Mistakes first.
 *
 * Nothing here is a copy of anything. The cards are `/__board/list`'s `quizzes`, `titles` and
 * `questions`, kept current by the change feed; the Mistakes count on each is the practice record's,
 * kept current by `dag:practice`. A preset is one quiz file, so a card's
 * Practice is that quiz's run, and Mistakes is the one preset the system makes.
 */

/**
 * What the Quizzes page runs, after `?quizzes=1&run=`: Mistakes, or every quiz in a folder as one run
 *, `folder:<path>`.
 */
export type QuizzesRun = "mistakes" | `folder:${string}`;

interface Card {
  name: string;
  title: string;
  folder: string;
  questions: number;
  mistakes: number;
}

const leaf = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const folderOf = (name: string) => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");

interface Props {
  list: BoardTree;
  practice: Practice | null;
  onOpen(name: string): void;
  onPractice(name: string): void;
  onMistakes(): void;
  /** Practise every quiz under a folder, as one run. */
  onPracticeFolder?(folder: string): void;
  /** Make a quiz called this. Absent while the app is locked, and so is the box. */
  onCreate?(title: string): void;
}

export function QuizzesView({ list, practice, onOpen, onPractice, onMistakes, onPracticeFolder, onCreate }: Props) {
  const [filter, setFilter] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const cards = useMemo<Card[]>(
    () =>
      list.quizzes
        .map((name) => ({
          name,
          title: list.titles[name] ?? leaf(name),
          folder: folderOf(name),
          questions: list.questions[name] ?? 0,
          mistakes: practice?.counts[list.ids[name] ?? ""] ?? 0,
        }))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }) || a.name.localeCompare(b.name)),
    [list, practice],
  );
  const folders = useMemo(() => [...new Set(cards.map((c) => c.folder))].sort(), [cards]);
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = cards.filter(
    (c) =>
      (folder === null || c.folder === folder) &&
      words.every((w) => c.title.toLowerCase().includes(w) || c.name.toLowerCase().includes(w)),
  );
  const inMistakes = practice?.pool.length ?? 0;
  /* A folder chosen: every quiz under it, subfolders too, is one run. */
  const inFolder = folder ? folderQuizzes(list.quizzes, list.titles, folder) : [];
  const folderQuestions = inFolder.reduce((n, name) => n + (list.questions[name] ?? 0), 0);

  const create = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    onCreate?.(title);
  };
  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      create();
    } else if (e.key === "Escape") {
      setDraft("");
    }
  };

  return (
    <div className="dag-quizzes" data-dag-quizzes="">
      <div className="dag-quizzes__bar">
        <input
          type="search"
          className="dag-quizzes__filter"
          placeholder="Filter quizzes"
          aria-label="Filter quizzes"
          value={filter}
          data-dag-quizzes-filter=""
          onChange={(e) => setFilter(e.target.value)}
        />
        {folders.length > 1 || (folders.length === 1 && folders[0] !== "") ? (
          <select
            className="dag-select dag-quizzes__folder"
            aria-label="Folder"
            value={folder ?? "\u0000"}
            data-dag-quizzes-folder=""
            onChange={(e) => setFolder(e.target.value === "\u0000" ? null : e.target.value)}
          >
            <option value={"\u0000"}>Every folder</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f || "Top level"}
              </option>
            ))}
          </select>
        ) : null}
        {folder && onPracticeFolder && inFolder.length ? (
          <button
            type="button"
            className="dag-quizzes__practice dag-quizzes__practice-folder"
            data-dag-quizzes-practice-folder={folder}
            disabled={folderQuestions === 0}
            title={`Every question of the ${inFolder.length} ${inFolder.length === 1 ? "quiz" : "quizzes"} in ${folder}, subfolders included, as one run`}
            onClick={() => onPracticeFolder(folder)}
          >
            <Play size={14} strokeWidth={2} aria-hidden="true" />
            Practice the folder
            <span className="dag-quizzes__count">
              {folderQuestions} {folderQuestions === 1 ? "question" : "questions"}
            </span>
          </button>
        ) : null}
      </div>
      <div className="dag-quizzes__grid">
        <section className="dag-quizzes__card dag-quizzes__card--mistakes" data-dag-quizzes-mistakes={inMistakes}>
          <h2 className="dag-quizzes__title">
            <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
            Mistakes
          </h2>
          <p className="dag-quizzes__meta">
            {inMistakes ? `${inMistakes} ${inMistakes === 1 ? "question" : "questions"} to practice` : "Nothing to practice"}
          </p>
          <p className="dag-quizzes__about">
            A question you get wrong comes here, and leaves once you get it right {practice?.graduate ?? 2}{" "}
            {(practice?.graduate ?? 2) === 1 ? "time" : "times in a row"} here.
          </p>
          {/* Nothing to practice is said in words above; a greyed button would say it twice. */}
          {inMistakes ? (
            <button type="button" className="dag-quizzes__practice" data-dag-quizzes-practice-mistakes="" onClick={onMistakes}>
              <Play size={14} strokeWidth={2} aria-hidden="true" />
              Practice
            </button>
          ) : null}
        </section>
        {shown.map((c) => (
          <section key={c.name} className="dag-quizzes__card" data-dag-quizzes-card={c.name}>
            <button type="button" className="dag-quizzes__open" onClick={() => onOpen(c.name)} title={c.name}>
              <h2 className="dag-quizzes__title">
                <GraduationCap size={16} strokeWidth={2} aria-hidden="true" />
                {c.title}
              </h2>
              {c.folder ? <span className="dag-quizzes__where">{c.folder}</span> : null}
            </button>
            <p className="dag-quizzes__meta">
              {c.questions} {c.questions === 1 ? "question" : "questions"}
              {c.mistakes ? <span className="dag-quizzes__mistakes"> · {c.mistakes} in Mistakes</span> : null}
            </p>
            <button
              type="button"
              className="dag-quizzes__practice"
              data-dag-quizzes-practice={c.name}
              disabled={c.questions === 0}
              onClick={() => onPractice(c.name)}
            >
              <Play size={14} strokeWidth={2} aria-hidden="true" />
              Practice
            </button>
          </section>
        ))}
        {onCreate ? (
          <section className="dag-quizzes__card dag-quizzes__card--new">
            <label className="dag-quizzes__new">
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              <input
                type="text"
                placeholder="New quiz"
                aria-label="New quiz title"
                value={draft}
                data-dag-quizzes-new=""
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onDraftKey}
              />
            </label>
          </section>
        ) : null}
      </div>
      {cards.length > 0 && shown.length === 0 ? <p className="dag-quizzes__empty">No quiz matches.</p> : null}
    </div>
  );
}
