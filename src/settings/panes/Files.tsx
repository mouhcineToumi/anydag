import { Images, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Switch, TextField } from "@/ui/controls";

import { SETTLE } from "../feedback";
import { refuseLocked, useLocked } from "../lock";
import { ATTACHMENTS, UPDATE_LINKS, readFlag, readPref, resetPrefs, writeFlag, writePref } from "../prefs";
import { resetSettingsWithUndo, writeSettings, type PasteSize } from "../store";
import { useSettings } from "../useSettings";

import { Field, Group, ICON, Reset } from "./common";

const PLACEMENT: { value: PasteSize; label: string; hint: string }[] = [
  { value: "screen", label: "As it appeared", hint: "The size it was on your screen. Usually right." },
  { value: "pixels", label: "Actual pixels", hint: "One image pixel per board pixel, so a 2× capture stays sharp zoomed out." },
  { value: "width", label: "Fixed width", hint: "Every image lands at the same width." },
];

/**
 * The vault's files and pictures: where an uploaded file is kept, whether a rename rewrites the
 * `[[wikilinks]]` to it, how a pasted image lands, and the images this board no longer draws.
 *
 * The attachments folder and link updating are the vault's own settings (`dag:attachments` and
 * `dag:update-links`, in the vault's bundle at `<vault>/.anydag/settings.json`): the server reads
 * them when the vault opens and again whenever the bundle is written, so a change applies to the
 * next upload or rename without a restart. A pasted image's placement is the settings object's,
 * which is kept with this vault too.
 *
 * **Unused images covers the open board only**, never the vault: the same refusal `/rmdir` makes by
 * not being recursive. A vault-wide button is one click that reaches into every board.
 */
export function FilesPane({ boardName }: { boardName: string | null }) {
  const s = useSettings();

  const stored = readPref(ATTACHMENTS) ?? "";
  const [draft, setDraft] = useState(stored);
  const [problem, setProblem] = useState<string | null>(null);
  const [links, setLinks] = useState(() => readFlag(UPDATE_LINKS, true));

  const commit = () => {
    const v = draft.trim().replace(/^\/+|\/+$/g, "");
    if (v.split("/").some((part) => part === ".." || part === ".") || v.includes("\\")) {
      setProblem("That has to be a folder inside the vault.");
      return;
    }
    setProblem(null);
    setDraft(v);
    if (v !== stored) writePref(ATTACHMENTS, v || null);
  };

  return (
    <>
      <Group title="Attachments">
        <Field
          label="Attachments folder"
          hint="Where an uploaded file is kept, inside the vault. Files already there stay where they are."
          save={ATTACHMENTS}
        >
          <TextField
            wide
            data-dag-setting-attachments=""
            spellCheck={false}
            autoComplete="off"
            placeholder="attachments"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape" && draft !== stored) {
                /* The first Escape takes the draft back; the next one closes Settings. */
                e.preventDefault();
                e.stopPropagation();
                setDraft(stored);
                setProblem(null);
              }
            }}
          />
        </Field>
        {problem ? (
          <p className="dag-settings__problem" role="alert" data-dag-setting-attachments-problem="">
            {problem}
          </p>
        ) : null}
      </Group>

      <Group title="Links">
        <Field
          label="Update links when a file moves"
          hint="Renaming or moving a file rewrites the [[wikilinks]] to it in every other file."
          save={UPDATE_LINKS}
        >
          <Switch
            data-dag-setting-update-links=""
            checked={links}
            onChange={(e) => {
              setLinks(e.target.checked);
              writeFlag(UPDATE_LINKS, e.target.checked);
            }}
          />
        </Field>
      </Group>

      <Group title="Pasted images">
        <Field label="Size" hint={PLACEMENT.find((p) => p.value === s.paste.size)?.hint} save="paste.size">
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
          <Field label="Width" save="paste.width" settle={SETTLE}>
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
        <Field
          label="Largest width kept"
          hint="Wider images are scaled down once, as PNG. Leave it empty to keep every original as it was pasted."
          save="paste.maxWidth"
          settle={SETTLE}
        >
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

      <Group title="Storage">
        <UnusedImages boardName={boardName} />
      </Group>

      <Reset
        what="Files and images"
        onReset={() => {
          const undoPaste = resetSettingsWithUndo(["paste"]);
          const undoPrefs = resetPrefs([ATTACHMENTS, UPDATE_LINKS]);
          setDraft("");
          setLinks(true);
          setProblem(null);
          return () => {
            undoPaste();
            undoPrefs();
            setDraft(readPref(ATTACHMENTS) ?? "");
            setLinks(readFlag(UPDATE_LINKS, true));
          };
        }}
      />
    </>
  );
}

/** Bytes, for a person: the count is the number that matters and this is the scale beside it. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Images in the open board's folder that nothing draws any more, and the second click that removes
 * them. Scoped to one board and never the vault, `/rmdir`'s refusal to be recursive by default:
 * a vault-wide button is one click that reaches into every board.
 */
function UnusedImages({ boardName }: { boardName: string | null }) {
  const unused = useUnusedAssets(boardName);
  /* Removing the files is a change to the board's folder, which the lock refuses. */
  const locked = useLocked();
  const hint = "Images no item on this board draws any more. Only this board's are counted.";
  if (!boardName) {
    return <Field label="Unused images" hint="Open a board to count the images nothing on it draws any more." plain />;
  }
  return (
    <Field label="Unused images on this board" hint={hint} plain>
      {unused.files.length === 0 ? (
        <span className="dag-settings__value" data-dag-setting-unused="0">
          None
        </span>
      ) : unused.asking ? (
        <span className="dag-settings__actions">
          <button
            type="button"
            className="dag-button dag-button--danger"
            data-dag-setting-sweep-confirm=""
            onClick={unused.sweep}
          >
            Remove {unused.files.length}
          </button>
          <button type="button" className="dag-icon" aria-label="Cancel" onClick={() => unused.ask(false)}>
            <X {...ICON} aria-hidden="true" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="dag-button"
          data-dag-setting-sweep=""
          data-dag-setting-unused={unused.files.length}
          onClick={() => (locked ? refuseLocked() : unused.ask(true))}
        >
          <Images size={14} strokeWidth={2} aria-hidden="true" />
          <span>
            {unused.files.length} · {size(unused.bytes)}
          </span>
        </button>
      )}
    </Field>
  );
}

type Unused = { file: string; bytes: number };

/**
 * What the server says is no longer drawn anywhere. Asked for when the tab opens rather than kept in
 * sync: this is a maintenance figure, not a setting, and the sweep recomputes server-side before
 * deleting anything, so what is shown is a reason to press the button and never the list acted on.
 */
function useUnusedAssets(board: string | null) {
  const [files, setFiles] = useState<Unused[]>([]);
  const [bytes, setBytes] = useState(0);
  const [asking, ask] = useState(false);

  const load = useCallback(async () => {
    if (!board) return;
    try {
      const r = await fetch(`/__board/assets/unused?name=${encodeURIComponent(board)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { files: Unused[]; bytes: number };
      setFiles(d.files ?? []);
      setBytes(d.bytes ?? 0);
    } catch {
      /* No server, or it is restarting. The row says "none", which is the honest thing to show
         when nothing has been counted. */
    }
  }, [board]);

  useEffect(() => {
    void load();
  }, [load]);

  const sweep = useCallback(() => {
    ask(false);
    void (async () => {
      try {
        if (board) await fetch(`/__board/assets/sweep?name=${encodeURIComponent(board)}`, { method: "POST" });
      } catch {
        /* Same. */
      }
      await load();
    })();
  }, [board, load]);

  return { files, bytes, asking, ask, sweep };
}
