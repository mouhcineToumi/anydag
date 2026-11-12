import { FolderOpen, Power } from "lucide-react";
import { useEffect, useState } from "react";

import { DEFAULT_THEME } from "@/theme/useTheme";
import { closeVault, currentOf, loadVaults, vaultsNow } from "@/vault/api";
import { switchVault } from "@/vault/current";
import { desktop } from "@/vault/desktop";
import { useVaults } from "@/vault/useVaults";
import { readTrash } from "@/ui/trashApi";

import { THEME, resetPrefs } from "../prefs";
import { resetSettingsWithUndo, writeSettings, type ProblemsShow } from "../store";
import { useSettings } from "../useSettings";

import { Fact, Facts, Field, Group, Reset } from "./common";

const PROBLEMS: { value: ProblemsShow; label: string; hint: string }[] = [
  {
    value: "notify",
    label: "Show, then hide",
    hint: "A new error shows for a few seconds. The count stays at the bottom until it is fixed.",
  },
  { value: "badge", label: "Count only", hint: "Nothing pops up. The count at the bottom opens the list." },
  { value: "off", label: "Hide", hint: "Nothing on the board. The editor panel still lists the open item's problems." },
];

/** What a theme is called for a person; its folder name is what a link and a board say. */
const THEME_LABEL: Record<string, string> = { paper: "Light", "paper-dark": "Dark", neutral: "Neutral" };
const themeLabel = (t: string): string => THEME_LABEL[t] ?? t.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The vault itself: where it is and what it is, how it looks (the theme is stored with the vault),
 * how loudly a board's problems speak, and closing it. **There is nothing here that removes the
 * folder**, and nothing that renames it — it is a folder the person already owns, and the file
 * manager is the place for that.
 *
 * The name, the location and the trash's retention are facts, drawn as a quiet label and value
 * list rather than rows with a control: there is nothing to press. The one action about the
 * location, *Show in folder*, stays a button.
 */
export function GeneralPane({
  themes,
  themeName,
  onTheme,
}: {
  themes: string[];
  themeName: string;
  onTheme(name: string): void;
}) {
  const s = useSettings();
  const here = currentOf(useVaults());
  useEffect(() => void loadVaults(), []);
  const reveal = desktop()?.revealInFolder;

  return (
    <>
      <Facts title="Folder">
        <Fact label="Name">
          <span className="dag-settings__value" data-dag-setting-vault-name="">
            {here.name}
          </span>
        </Fact>
        <Fact label="Location" stack>
          <span className="dag-settings__path">
            <span className="dag-settings__pathtext" data-dag-setting-vault-path="" title={here.path}>
              {here.path}
            </span>
            {reveal ? (
              <button
                type="button"
                className="dag-button"
                data-dag-setting-vault-reveal=""
                onClick={() => void reveal(here.path)}
              >
                <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                <span>Show in folder</span>
              </button>
            ) : null}
          </span>
        </Fact>
      </Facts>

      <Group title="Appearance">
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

      <Group title="Problems">
        <Field
          label="When a board has an error"
          hint={PROBLEMS.find((p) => p.value === s.problems.show)?.hint}
          save="problems.show"
        >
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

      <Facts title="Storage">
        <TrashDays />
      </Facts>

      <Group title="Close">
        <Field
          label="Close this vault"
          hint="The folder and its files stay as they are, and the vault stays on the recent list."
          plain
        >
          <button type="button" className="dag-button" data-dag-vault-close-setting="" onClick={() => void closeThis(here.id)}>
            <Power size={14} strokeWidth={2} aria-hidden="true" />
            <span>Close vault</span>
          </button>
        </Field>
      </Group>

      <Reset
        what="General"
        onReset={() => {
          /* Problems are the settings object's; the theme is the vault's own preference. Both are
             drawn here, so one Reset covers both and touches nothing on another tab. */
          const beforeTheme = themeName;
          const undoProblems = resetSettingsWithUndo(["problems"]);
          resetPrefs([THEME]);
          onTheme(DEFAULT_THEME);
          return () => {
            undoProblems();
            onTheme(beforeTheme);
          };
        }}
      />
    </>
  );
}

/**
 * Close this vault, and land on another open one. The folder is not touched; `closeVault` takes it
 * off this server's list of open vaults, and the switcher lists it again a request later.
 */
async function closeThis(id: string): Promise<void> {
  try {
    await closeVault(id);
  } catch {
    return;
  }
  const next = (vaultsNow() ?? []).find((v) => v.open && v.id !== id);
  switchVault(next?.id ?? "");
}

/**
 * How long the trash keeps what is deleted: the server's `ANYDAG_TRASH_DAYS`, read off the trash
 * itself and said here as a fact — read-only, like the upload limits.
 */
function TrashDays() {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void readTrash().then((got) => live && setDays(got?.days ?? null));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Fact label="Trash keeps files for" stack>
      <span className="dag-settings__value" data-dag-setting-trash-days={days ?? ""}>
        {days === null ? "…" : `${days} ${days === 1 ? "day" : "days"}`}
      </span>
    </Fact>
  );
}
