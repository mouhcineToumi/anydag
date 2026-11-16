import { useState } from "react";

import { DEFAULT_THEME } from "@/theme/useTheme";
import { TEXT_SIZE_STEPS, readTextSize, writeTextSize, type TextSize } from "@/ui/textSize";

import { TEXT_SIZE, THEME } from "../prefs";

import { Field, Group, Reset } from "./common";

/** What a theme is called for a person; its folder name is what a link and a board say. */
const THEME_LABEL: Record<string, string> = { paper: "Light", "paper-dark": "Dark", neutral: "Neutral" };
const themeLabel = (t: string): string => THEME_LABEL[t] ?? t.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * How the app looks. **The person's, the same in every vault** (#191): it was the vault's, so opening
 * another vault changed the theme, which nobody expected of a preference about their own screen.
 *
 * **Text size** (#325) is the second row here, and it is one step for a note and the chrome together.
 * Its state lives in this component because nothing else re-renders when it changes: the write is an
 * attribute on `<html>` (`src/ui/textSize.ts`), and `chrome.css` does the rest. The diagram surface
 * is deliberately not in it — a board keeps its own zoom.
 */
export function AppearancePane({
  themes,
  themeName,
  onTheme,
}: {
  themes: string[];
  themeName: string;
  onTheme(name: string): void;
}) {
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  const chooseTextSize = (size: TextSize) => {
    setTextSize(size);
    writeTextSize(size);
  };
  return (
    <>
      <Group>
        <Field
          label="Theme"
          hint="A theme in the page's address still wins, so a shared link shows what it was meant to."
          save={THEME}
        >
          <select
            className="dag-select"
            data-dag-setting-theme=""
            aria-label="Theme"
            value={themeName}
            onChange={(e) => onTheme(e.target.value)}
          >
            {themes.map((t) => (
              <option key={t} value={t}>
                {themeLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Text size"
          hint="Sets a note and the app's own words to the same step. A board keeps its own zoom."
          save={TEXT_SIZE}
        >
          <select
            className="dag-select"
            data-dag-setting-text-size=""
            aria-label="Text size"
            value={textSize}
            onChange={(e) => chooseTextSize(e.target.value as TextSize)}
          >
            {TEXT_SIZE_STEPS.map((step) => (
              <option key={step.value} value={step.value}>
                {step.label}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <Reset
        what="Appearance"
        onReset={() => {
          /* Both rows are this tab's and both setters repaint, so Undo is the same two calls with
             the values that were showing. */
          const beforeTheme = themeName;
          const beforeSize = textSize;
          onTheme(DEFAULT_THEME);
          chooseTextSize("default");
          return () => {
            onTheme(beforeTheme);
            chooseTextSize(beforeSize);
          };
        }}
      />
    </>
  );
}
