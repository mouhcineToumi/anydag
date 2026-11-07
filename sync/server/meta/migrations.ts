/**
 * The migrations (sync/server/meta/migrations/NNN-*.sql), with the files as the source of truth:
 * read once at module load, in name order, each applied whole in its own transaction under the
 * migrate lock. The directory is `ANYDAG_SYNC_MIGRATIONS` when that is set and otherwise next to
 * this source file; the bundled server copies the directory beside itself, so the same list answers
 * everywhere the module is loaded.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Migration {
  name: string;
  sql: string;
}

/** Where the migration files are — the environment's word if it has one, else beside the source. */
const migrationsDir = (): string => {
  const given = process.env.ANYDAG_SYNC_MIGRATIONS;
  if (given !== undefined && given !== "") return given.startsWith("file://") ? fileURLToPath(given) : given;
  return fileURLToPath(new URL("./migrations/", import.meta.url));
};

/** Read once, sorted — `001-` before `002-` — and frozen for the life of the process. */
export const MIGRATIONS: readonly Migration[] = (() => {
  const dir = migrationsDir();
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch {
    throw new Error(
      `cannot read the sync migrations directory ${dir}` +
        (process.env.ANYDAG_SYNC_MIGRATIONS === undefined ? " (set ANYDAG_SYNC_MIGRATIONS when running from a bundle)" : ""),
    );
  }
  return names.map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, "utf8") }));
})();
