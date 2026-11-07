import { FolderOpen, Images, Power, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { closeVault, currentOf, loadVaults, vaultsNow } from "@/vault/api";
import { switchVault } from "@/vault/current";
import { desktop } from "@/vault/desktop";
import { useVaults } from "@/vault/useVaults";
import { readTrash } from "@/ui/trashApi";
import { refuseLocked, useLocked } from "../lock";

import { ATTACHMENTS, UPDATE_LINKS, readFlag, readPref, writeFlag, writePref } from "../prefs";
import { Switch, TextField } from "@/ui/controls";

import { Field, Group, ICON } from "./common";

/**
 * The vault itself: where it is, where it keeps attachments, what its files leave behind, and
 * closing it. **There is nothing here that removes the folder**, and nothing that renames it — it is
 * a folder the person already owns, and the file manager is the place for that.
 *
 * The attachments folder is the vault's own setting (`dag:attachments`, in the vault's bundle at
 * `<vault>/.anydag/settings.json`): the server reads it when the vault opens and again whenever the
 * bundle is written, so a change applies to the next upload without a restart. Relative to the vault's
 * root, and `attachments` when empty.
 */
export function VaultPane({ boardName }: { boardName: string | null }) {
  const here = currentOf(useVaults());
  useEffect(() => void loadVaults(), []);
  const reveal = desktop()?.revealInFolder;

  const stored = readPref(ATTACHMENTS) ?? "";
  const [draft, setDraft] = useState(stored);
  const [problem, setProblem] = useState<string | null>(null);

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

  const closeThis = async () => {
    try {
      await closeVault(here.id);
    } catch {
      return;
    }
    const next = (vaultsNow() ?? []).find((v) => v.open && v.id !== here.id);
    switchVault(next?.id ?? "");
  };

  return (
    <>
      <Group title="Folder">
        <Field label="Name" plain>
          <span className="dag-settings__value" data-dag-setting-vault-name="">
            {here.name}
          </span>
        </Field>
        <Field label="Location" plain stack>
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
        </Field>
      </Group>

      <Group title="Attachments">
        <Field
          label="Attachments folder"
          hint="Where an uploaded file is kept, inside the vault. Files already there stay where they are."
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
        <UpdateLinks />
      </Group>

      <Group title="Storage">
        <UnusedImages boardName={boardName} />
        <TrashDays />
      </Group>

      <Group title="Close">
        <Field
          label="Close this vault"
          hint="The folder and its files stay as they are, and the vault stays on the recent list."
          plain
        >
          <button type="button" className="dag-button" data-dag-vault-close-setting="" onClick={() => void closeThis()}>
            <Power size={14} strokeWidth={2} aria-hidden="true" />
            <span>Close vault</span>
          </button>
        </Field>
      </Group>
    </>
  );
}

/**
 * Obsidian's *Automatically update internal links*: on, a rename, a move or a folder moved rewrites
 * every `[[wikilink]]` in the vault that named what moved, so it still does (`server/relink.ts`). The
 * vault's own setting, `dag:update-links`, read by the server on every rename — so it holds for the
 * CLI and an agent too. A `dag:` reference holds an id and never needed it.
 */
function UpdateLinks() {
  const [on, setOn] = useState(() => readFlag(UPDATE_LINKS, true));
  return (
    <Field
      label="Update links when a file moves"
      hint="Renaming or moving a file rewrites the [[wikilinks]] to it in every other file."
    >
      <Switch
        data-dag-setting-update-links=""
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          writeFlag(UPDATE_LINKS, e.target.checked);
        }}
      />
    </Field>
  );
}

/**
 * How long the trash keeps what is deleted: the server's `ANYDAG_TRASH_DAYS`, read off
 * the trash itself, said here as the upload limits are said under Import and export — read-only.
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
    <Field label="Trash keeps files for" hint="Restore them from the trash at the foot of the sidebar." plain>
      <span className="dag-settings__value" data-dag-setting-trash-days={days ?? ""}>
        {days === null ? "…" : `${days} ${days === 1 ? "day" : "days"}`}
      </span>
    </Field>
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
