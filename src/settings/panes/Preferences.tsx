import { useEffect, useState } from "react";

import { readPractice, setGraduate } from "@/ui/quiz/practice";

import { resetSettings, writeSettings, type PasteSize, type ProblemsShow } from "../store";
import { useSettings } from "../useSettings";
import { TextField } from "@/ui/controls";

import { Field, Group, Reset } from "./common";

const PROBLEMS: { value: ProblemsShow; label: string; hint: string }[] = [
  { value: "notify", label: "Show, then hide", hint: "A new error shows for a few seconds. The count stays at the bottom until it is fixed." },
  { value: "badge", label: "Count only", hint: "Nothing pops up. The count at the bottom opens the list." },
  { value: "off", label: "Hide", hint: "Nothing on the board. The editor panel still lists the open item's problems." },
];

const PLACEMENT: { value: PasteSize; label: string; hint: string }[] = [
  { value: "screen", label: "As it appeared", hint: "The size it was on your screen. Usually right." },
  { value: "pixels", label: "Actual pixels", hint: "One image pixel per board pixel, so a 2× capture stays sharp zoomed out." },
  { value: "width", label: "Fixed width", hint: "Every image lands at the same width." },
];

/** What a theme is called for a person; its folder name is what a link and a board say. */
const THEME_LABEL: Record<string, string> = { paper: "Light", "paper-dark": "Dark", neutral: "Neutral" };
const themeLabel = (t: string): string => THEME_LABEL[t] ?? t.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * How this vault looks and behaves: the theme, how loudly problems speak, and how a pasted
 * image lands — plus the quiz threshold. Every control writes as it changes; there is no Save, which
 * is what the rest of the app does with a file.
 */
export function PreferencesPane({ themes, themeName, onTheme }: { themes: string[]; themeName: string; onTheme(name: string): void }) {
  const s = useSettings();
  return (
    <>
      <Group title="Appearance">
        <Field label="Theme" hint="A theme in the page's address still wins, so a shared link shows what it was meant to.">
          <select className="dag-select" data-dag-setting-theme="" aria-label="Theme" value={themeName} onChange={(e) => onTheme(e.target.value)}>
            {themes.map((t) => (
              <option key={t} value={t}>
                {themeLabel(t)}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <Group title="Problems">
        <Field label="When a board has an error" hint={PROBLEMS.find((p) => p.value === s.problems.show)?.hint}>
          <select
            className="dag-select"
            data-dag-setting-problems=""
            value={s.problems.show}
            onChange={(e) => writeSettings({ problems: { show: e.target.value as ProblemsShow } })}
          >
            {PROBLEMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <Group title="Pasted images">
        <Field label="Size" hint={PLACEMENT.find((p) => p.value === s.paste.size)?.hint}>
          <select
            className="dag-select"
            data-dag-setting-paste-size=""
            value={s.paste.size}
            onChange={(e) => writeSettings({ paste: { size: e.target.value as PasteSize } })}
          >
            {PLACEMENT.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        {s.paste.size === "width" ? (
          <Field label="Width">
            <TextField
              data-dag-setting-paste-width=""
              type="number"
              min={40}
              max={4000}
              step={20}
              suffix="px"
              value={s.paste.width}
              onChange={(e) => writeSettings({ paste: { width: Number(e.target.value) } })}
            />
          </Field>
        ) : null}
        <Field label="Largest width kept" hint="Wider images are scaled down once, as PNG. Leave it empty to keep every original as it was pasted.">
          <TextField
            data-dag-setting-paste-max=""
            type="number"
            min={64}
            max={8000}
            step={100}
            placeholder="No limit"
            suffix="px"
            value={s.paste.maxWidth ?? ""}
            onChange={(e) => writeSettings({ paste: { maxWidth: e.target.value === "" ? null : Number(e.target.value) } })}
          />
        </Field>
      </Group>

      <Group title="Quizzes">
        <Graduate />
      </Group>

      <Reset what="problems and pasted images (the theme stays)" onReset={() => resetSettings(["problems", "paste"])} />
    </>
  );
}

/**
 * How many right answers in a row, inside the Mistakes run, take a question out of it.
 *
 * **Not a preference in `settings/store.ts`**: the server decides what is in Mistakes with this
 * number, so it is kept with the practice record and read from there — a copy in the browser would be
 * the copy that disagrees. So it is asked for when the tab opens and written with a `PUT`, and a
 * change announces `dag:practice`, which every count on the page is listening for.
 */
function Graduate() {
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
    <Field
      label="Right answers to leave Mistakes"
      hint={failed ? "That did not save. Try again in a moment." : "How many times in a row you answer a question right in the Mistakes run before it leaves."}
    >
      <select
        className="dag-select dag-select--narrow"
        data-dag-setting-graduate=""
        disabled={n === null}
        value={n ?? 2}
        onChange={(e) => {
          const next = Number(e.target.value);
          setN(next);
          setFailed(false);
          void setGraduate(next).then((got) => (got === null ? setFailed(true) : setN(got)));
        }}
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </Field>
  );
}
