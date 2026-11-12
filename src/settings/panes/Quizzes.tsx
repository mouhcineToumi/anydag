import { useEffect, useState } from "react";

import { readPractice, setGraduate } from "@/ui/quiz/practice";

import { markSaved } from "../saved";

import { Field, Group, Reset } from "./common";

/** The threshold the server starts from: `GRADUATE` in `server/practice.ts`, and 2 in the page. */
const DEFAULT_GRADUATE = 2;

/**
 * How many right answers in a row, inside the Mistakes run, take a question out of it.
 *
 * **Not a preference in `settings/store.ts`**: the server decides what is in Mistakes with this
 * number, so it is kept with the practice record in the app's home and read from there — a copy in
 * the browser would be the copy that disagrees. So it is asked for when the tab opens and written
 * with a `PUT`, and a change announces `dag:practice`, which every count on the page is listening
 * for.
 *
 * It is the person's, the same in every vault, which is why the tab is under *You*.
 */
export function QuizzesPane() {
  const [n, setN] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void readPractice().then((p) => live && p && setN(p.graduate));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <Group title="Practice">
        <Field
          label="Right answers to leave Mistakes"
          hint={
            failed
              ? "That did not save. Try again in a moment."
              : "How many times in a row you answer a question right in the Mistakes run before it leaves."
          }
          save="practice.graduate"
        >
          <select
            className="dag-select dag-select--narrow"
            data-dag-setting-graduate=""
            disabled={n === null}
            value={n ?? DEFAULT_GRADUATE}
            onChange={(e) => {
              const next = Number(e.target.value);
              setN(next);
              setFailed(false);
              void setGraduate(next).then((got) => {
                if (got === null) setFailed(true);
                else {
                  setN(got);
                  markSaved("practice.graduate");
                }
              });
            }}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <Reset
        what="Quizzes"
        onReset={() => {
          const before = n ?? DEFAULT_GRADUATE;
          setN(DEFAULT_GRADUATE);
          setFailed(false);
          void setGraduate(DEFAULT_GRADUATE).then((got) => {
            if (got === null) setFailed(true);
            else setN(got);
          });
          return () => {
            setN(before);
            void setGraduate(before).then((got) => {
              if (got === null) setFailed(true);
              else setN(got);
            });
          };
        }}
      />
    </>
  );
}
