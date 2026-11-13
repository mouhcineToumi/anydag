import { DEFAULT_THEME } from "@/theme/useTheme";

import { THEME } from "../prefs";

import { Field, Group, Reset } from "./common";

/** What a theme is called for a person; its folder name is what a link and a board say. */
const THEME_LABEL: Record<string, string> = { paper: "Light", "paper-dark": "Dark", neutral: "Neutral" };
const themeLabel = (t: string): string => THEME_LABEL[t] ?? t.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * How the app looks. **The person's, the same in every vault** (#191): it was the vault's, so opening
 * another vault changed the theme, which nobody expected of a preference about their own screen.
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
      </Group>

      <Reset
        what="Appearance"
        onReset={() => {
          /* `onTheme` writes the preference and repaints, so Undo is the same call with the old name. */
          const before = themeName;
          onTheme(DEFAULT_THEME);
          return () => onTheme(before);
        }}
      />
    </>
  );
}
