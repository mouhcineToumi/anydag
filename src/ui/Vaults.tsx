import { Check, ChevronsUpDown, FolderOpen, FolderPlus, Power, Settings2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

import { type Vault, closeVault, createVault, currentOf, loadVaults, openVault, vaultsNow } from "@/vault/api";
import { switchVault } from "@/vault/current";
import { desktop } from "@/vault/desktop";
import { useHome, useVaults } from "@/vault/useVaults";

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The mark a vault wears: its first letter, which is how Notion and Slack tell theirs apart. */
function Mark({ name }: { name: string }) {
  return (
    <span className="dag-vault__mark" aria-hidden="true">
      {(name.trim()[0] ?? "·").toUpperCase()}
    </span>
  );
}

const sayOf = (error: unknown): string => (error instanceof Error ? error.message : "That did not work.");

/** Go to a vault from the recent list: open it first when it is only remembered. */
async function enterVault(v: Pick<Vault, "id" | "path" | "open">): Promise<void> {
  if (!v.open) await openVault(v.path);
  switchVault(v.id);
}

/** Open a folder the person named (typed, or picked) and go there. */
export async function enterPath(path: string): Promise<void> {
  const opened = await openVault(path);
  switchVault(opened.id);
}

/**
 * The folder dialog when the desktop shell provides one; a browser has none, and the caller shows a
 * field for a path instead. `undefined` means there is no dialog, `null` that it was cancelled.
 */
export async function pickFolder(): Promise<string | null | undefined> {
  const pick = desktop()?.pickFolder;
  return pick ? await pick() : undefined;
}

/** Typing the path of a folder to open — the browser's way, and the desktop shell's fallback. */
export function OpenFolderForm({ onCancel }: { onCancel?(): void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);

  async function go(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      await enterPath(path.trim());
    } catch (error) {
      setProblem(sayOf(error));
      setBusy(false);
    }
  }

  return (
    <form
      className="dag-vault__form"
      data-dag-vault-open-form=""
      onSubmit={(e) => void go(e)}
      onKeyDown={(e) => stopKeys(e, onCancel)}
    >
      <label>
        <span>Folder to open</span>
        <input
          ref={box}
          className="dag-sidebar__name-input"
          data-dag-vault-open-path=""
          spellCheck={false}
          autoComplete="off"
          placeholder="/home/you/notes"
          disabled={busy}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </label>
      <div className="dag-vault__form-acts">
        {onCancel ? (
          <button type="button" className="dag-button" onClick={onCancel} disabled={busy}>
            <span>Cancel</span>
          </button>
        ) : null}
        <button
          type="submit"
          className="dag-button dag-button--primary"
          data-dag-vault-open-go=""
          disabled={busy || !path.trim()}
        >
          <span>{busy ? "Opening…" : "Open"}</span>
        </button>
      </div>
      {/* Always in the flow, so a refusal replaces a line rather than pushing the actions down. */}
      <p className="dag-vault__form-error" role="alert" data-dag-vault-problem={problem ? "" : undefined}>
        {problem}
      </p>
    </form>
  );
}

/** A parent folder and a name: the new vault is `<parent>/<name>`. */
export function CreateVaultForm({ onCancel }: { onCancel?(): void }) {
  const home = useHome();
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  /* The home folder is the default parent, filled in once the list says where it is. */
  const where = parent || home;
  const browse = desktop()?.pickFolder;

  async function go(e: FormEvent) {
    e.preventDefault();
    if (!where.trim() || !name.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await createVault(where.trim(), name.trim());
      switchVault(made.id);
    } catch (error) {
      setProblem(sayOf(error));
      setBusy(false);
    }
  }

  return (
    <form
      className="dag-vault__form"
      data-dag-vault-create-form=""
      onSubmit={(e) => void go(e)}
      onKeyDown={(e) => stopKeys(e, onCancel)}
    >
      <label>
        <span>Name</span>
        <input
          ref={box}
          className="dag-sidebar__name-input"
          data-dag-vault-create-name=""
          spellCheck={false}
          autoComplete="off"
          maxLength={80}
          placeholder="My notes"
          disabled={busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        <span>In the folder</span>
        <span className="dag-vault__field-row">
          <input
            className="dag-sidebar__name-input"
            data-dag-vault-create-parent=""
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            value={where}
            onChange={(e) => setParent(e.target.value)}
          />
          {browse ? (
            <button
              type="button"
              className="dag-button"
              data-dag-vault-create-browse=""
              disabled={busy}
              onClick={() => void browse().then((p) => p && setParent(p))}
            >
              <span>Browse…</span>
            </button>
          ) : null}
        </span>
      </label>
      <div className="dag-vault__form-acts">
        {onCancel ? (
          <button type="button" className="dag-button" onClick={onCancel} disabled={busy}>
            <span>Cancel</span>
          </button>
        ) : null}
        <button
          type="submit"
          className="dag-button dag-button--primary"
          data-dag-vault-create-go=""
          disabled={busy || !name.trim() || !where.trim()}
        >
          <span>{busy ? "Creating…" : "Create"}</span>
        </button>
      </div>
      {/* Always in the flow, so a refusal replaces a line rather than pushing the actions down. */}
      <p className="dag-vault__form-error" role="alert" data-dag-vault-problem={problem ? "" : undefined}>
        {problem}
      </p>
    </form>
  );
}

/** Keys typed in a form are the form's: the canvas's shortcuts must not hear them; Escape lets go. */
function stopKeys(e: ReactKeyboardEvent, cancel?: () => void) {
  e.stopPropagation();
  if (e.key === "Escape" && cancel) {
    e.preventDefault();
    cancel();
  }
}

/** The recent vaults as rows to go to — used by the picker when no vault is open. */
export function RecentVaults() {
  const all = useVaults();
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => void loadVaults(), []);
  const rows = all ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="dag-novault__recent" data-dag-vault-recent="">
      {rows.map((v) => (
        <div key={v.id} className="dag-vault__line">
          <button
            type="button"
            className="dag-more__item dag-vault__item"
            data-dag-vault={v.id}
            disabled={v.missing}
            title={v.path}
            onClick={() => void enterVault(v).catch((e) => setProblem(sayOf(e)))}
          >
            <Mark name={v.name} />
            <span>{v.name}</span>
            {v.missing ? <span className="dag-vault__note">not found</span> : <span className="dag-vault__path">{v.path}</span>}
          </button>
          {!v.open ? (
            <button
              type="button"
              className="dag-icon dag-vault__forget"
              data-dag-vault-forget={v.id}
              aria-label={`Remove ${v.name} from the list`}
              title="Remove from the list"
              onClick={() => void closeVault(v.id, true).catch((e) => setProblem(sayOf(e)))}
            >
              <X {...ICON} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      {problem ? (
        <p className="dag-vault__problem" role="alert" data-dag-vault-problem="">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The vault this tab is in, and the way to another: the first thing in the sidebar. A press opens a
 * menu of the recent vaults, the one this tab is in ticked and a missing one greyed with "not found";
 * below them opening a folder, making a vault, closing this one and its settings.
 *
 * **Switching is a page load** (`switchVault`), never state: every subscription, cache and preference
 * on the page belongs to the vault it was opened in, and starting again is the one way none of them
 * can be left behind. The list is asked for again whenever the menu opens — a vault opened from the
 * terminal is only seen by asking. **Nothing here removes a folder**: *Close vault* stops serving it
 * and *Remove from list* forgets it; the folder is the person's.
 *
 * Names grepped first: `dag-vault*` and `data-dag-vault*` were nobody's.
 */
export function VaultSwitcher({ onSettings }: { onSettings(): void }) {
  const all = useVaults();
  const here = currentOf(all);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<"open" | "create" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    void loadVaults();
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  useEffect(() => {
    if (open && !asking)
      menu.current?.querySelector<HTMLElement>("[role=menuitemradio][aria-checked=true],[role=menuitem]")?.focus();
  }, [open, asking]);

  function close() {
    setOpen(false);
    setAsking(null);
    setProblem(null);
  }

  async function openFolder() {
    setProblem(null);
    const picked = await pickFolder();
    if (picked === undefined) return setAsking("open");
    if (picked === null) return;
    try {
      await enterPath(picked);
    } catch (error) {
      setProblem(sayOf(error));
    }
  }

  async function closeThis() {
    setProblem(null);
    try {
      await closeVault(here.id);
      const next = (vaultsNow() ?? (await loadVaults()) ?? []).find((v) => v.open && v.id !== here.id);
      switchVault(next?.id ?? "");
    } catch (error) {
      setProblem(sayOf(error));
    }
  }

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      if (asking) setAsking(null);
      else {
        close();
        button.current?.focus();
      }
      return;
    }
    if (!open || asking || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>("[role=menuitem],[role=menuitemradio]:not(:disabled)") ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="dag-vault" ref={wrap} onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className="dag-vault__button"
        data-dag-vault-switcher={here.id}
        aria-haspopup="menu"
        aria-expanded={open}
        title={here.path ? `Vault: ${here.name} (${here.path})` : `Vault: ${here.name}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Mark name={here.name} />
        <span className="dag-vault__name" data-dag-vault-current="">
          {here.name}
        </span>
        <ChevronsUpDown size={14} strokeWidth={2} aria-hidden="true" className="dag-vault__chev" />
      </button>

      {open ? (
        <div ref={menu} className="dag-sidebar__menu dag-vault__menu" role="menu" aria-label="Vaults" data-dag-vault-menu="">
          <p className="dag-sidebar__menu-who" aria-hidden="true">
            Vaults
          </p>
          {(all ?? [here]).map((v: Vault) => (
            <div key={v.id} className="dag-vault__line" role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={v.id === here.id}
                className="dag-more__item dag-vault__item"
                data-dag-vault={v.id}
                disabled={v.missing}
                title={v.path}
                onClick={() => {
                  if (v.id === here.id) return close();
                  void enterVault(v).catch((error) => setProblem(sayOf(error)));
                }}
              >
                <Mark name={v.name} />
                <span>{v.name}</span>
                {v.missing ? <span className="dag-vault__note">not found</span> : null}
                {v.id === here.id ? <Check {...ICON} aria-hidden="true" className="dag-vault__tick" /> : null}
              </button>
              {!v.open ? (
                <button
                  type="button"
                  role="menuitem"
                  className="dag-icon dag-vault__forget"
                  data-dag-vault-forget={v.id}
                  aria-label={`Remove ${v.name} from the list`}
                  title="Remove from the list"
                  onClick={() => void closeVault(v.id, true).catch((error) => setProblem(sayOf(error)))}
                >
                  <X {...ICON} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          <hr className="dag-vault__rule" />
          {asking === "open" ? (
            <OpenFolderForm onCancel={() => setAsking(null)} />
          ) : (
            <button
              type="button"
              role="menuitem"
              className="dag-more__item"
              data-dag-vault-open=""
              onClick={() => void openFolder()}
            >
              <FolderOpen {...ICON} aria-hidden="true" />
              <span>Open folder…</span>
            </button>
          )}
          {asking === "create" ? (
            <CreateVaultForm onCancel={() => setAsking(null)} />
          ) : (
            <button
              type="button"
              role="menuitem"
              className="dag-more__item"
              data-dag-vault-create=""
              onClick={() => setAsking("create")}
            >
              <FolderPlus {...ICON} aria-hidden="true" />
              <span>Create vault…</span>
            </button>
          )}
          <hr className="dag-vault__rule" />
          <button
            type="button"
            role="menuitem"
            className="dag-more__item"
            data-dag-vault-close=""
            onClick={() => void closeThis()}
          >
            <Power {...ICON} aria-hidden="true" />
            <span>Close vault</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="dag-more__item"
            data-dag-vault-settings=""
            onClick={() => {
              close();
              onSettings();
            }}
          >
            <Settings2 {...ICON} aria-hidden="true" />
            <span>Vault settings…</span>
          </button>
          {problem ? (
            <p className="dag-vault__problem" role="alert" data-dag-vault-problem="">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
