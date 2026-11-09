/**
 * A connection to the sync server's state, two ways: `pgDb` over a real
 * Postgres through a `pg` pool, `pgliteDb` over PGlite in this process for the fast tier. `PgMeta`
 * (pg.ts) speaks only to the `Db` interface, so the contract suite runs the very same statements
 * against both.
 *
 * What is load-bearing is what a row comes back *as*, the same on both adapters: `bigint` as a JS
 * `number` (the sizes, seqs and counters this data carries stay well inside the number's range);
 * `timestamptz` as an ISO string in UTC; `date` as `YYYY-MM-DD`, never as a Date at midnight of
 * some zone; `jsonb` as a JS value. `pg` gets there with a per-pool type set — not the global one,
 * whose answers would silently become every other `pg` client's in this process. PGlite gets the
 * two cheap conversions from per-instance parsers, and one pass over the returned fields for
 * `timestamptz`, whose instant the engine has already resolved to a `Date`.
 *
 * A transaction checks out one client (`pg`) or opens PGlite's own; a throw rolls it back and is
 * rethrown. Nested `tx()` is refused, not flattened: a second BEGIN on the same client would
 * orphan the first, and half-remembered commits are not a thing this server may have.
 */
import { Pool, PoolClient, types as pgTypes, type CustomTypesConfig } from "pg";
import { PGlite, type Transaction } from "@electric-sql/pglite";

import type { Db } from "./types";

/** The row OIDs these adapters own. Everything else passes through whatever the driver says. */
const OID = { int8: 20, date: 1082, timestamp: 1114, timestamptz: 1184 } as const;

type Row = Record<string, unknown>;
type Field = { name: string; dataTypeID: number };
type Parser = (value: string) => unknown;
type TypeSet = { getTypeParser(oid: number, format?: string): Parser };

/** `timestamptz`: the engine parsed the instant; the port wants that instant as text. */
const asIso = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value);

/** The pool's settings beyond the URL. */
export interface PgOptions {
  /** The schema its connections run in, as `search_path` in the startup packet — the contract
   * suite runs against one schema per run, and the pool owns how its connections get there. */
  schema?: string;
}

/** A schema name is ours or the caller's; either way it must parse to one place. */
const ident = (schema: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`not a Postgres schema name: ${JSON.stringify(schema)}`);
  return schema;
};

/** The pool's own type set, wrapped over pg's global one — this module's answers, nobody else's. */
const pgTypeParser = pgTypes.getTypeParser as (id: number, format?: "text" | "binary") => Parser;
const ownTypes = (): TypeSet => ({
  getTypeParser(oid, format) {
    const base: Parser = format === "binary" ? pgTypeParser(oid, format) : pgTypeParser(oid);
    if (format === "binary") return base; // rows are text unless somebody asked; the binary set is pg's own
    switch (oid) {
      case OID.int8:
        return (value) => Number(value);
      case OID.date:
        return (value) => value; // the text *is* the port's `YYYY-MM-DD`
      case OID.timestamp:
        return (value) => value; // no offset in the text: pg's local-time Date would be a lie
      case OID.timestamptz:
        // pg's own parse did the offset arithmetic; answer as text.
        return (value) => asIso(base(value));
      default:
        return base;
    }
  },
});

/** The Postgres half: a pool, one client checked out per transaction. */
export function pgDb(url: string, opts?: PgOptions): Db {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    types: ownTypes() as unknown as CustomTypesConfig,
    ...(opts !== undefined && opts.schema !== undefined ? { options: `-c search_path=${ident(opts.schema)}` } : {}),
  });
  // A dead idle connection (the server restarted underneath us) reports on the pool; every query
  // has its own error to answer with. An unhandled "error" would crash the process for nothing.
  pool.on("error", () => {});
  return new PoolDb(pool);
}

class PoolDb implements Db {
  constructor(private readonly pool: Pool) {}

  async query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = params === undefined ? await this.pool.query(sql) : await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tx<T>(fn: (q: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      let out: T;
      let committed = false;
      try {
        out = await fn(new ClientDb(client));
        await client.query("commit");
        committed = true;
      } finally {
        if (!committed) {
          try {
            await client.query("rollback");
          } catch {
            // The connection may have gone with the fault; releasing below is all that is left.
          }
        }
      }
      return out;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** The transaction's face of a checked-out client. */
class ClientDb implements Db {
  constructor(private readonly client: PoolClient) {}

  async query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = params === undefined ? await this.client.query(sql) : await this.client.query(sql, params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  tx<T>(): Promise<T> {
    return Promise.reject(new Error("nested Db.tx: the transaction's `q` is the whole of what a stage may use"));
  }

  close(): Promise<void> {
    return Promise.reject(new Error("close(): a transaction client closes when its transaction does"));
  }
}

/** PGlite returns `timestamptz` as a `Date`; only that one OID needs the walk over returned fields. */
const pgliteRow = (rows: unknown[], fields: readonly Field[]): unknown[] => {
  const casts = fields.map((f) => (f.dataTypeID === OID.timestamptz ? asIso : undefined));
  if (casts.every((c) => c === undefined)) return rows;
  return rows.map((row) => {
    const out: Row = { ...(row as Row) };
    casts.forEach((cast, i) => {
      if (cast !== undefined) out[fields[i]!.name] = cast(out[fields[i]!.name]);
    });
    return out;
  });
};

/** PGlite's per-instance readers: `bigint` as a number, `date` as the text it was. */
const pgliteParsers = {
  [OID.int8]: (value: string): number => Number(value),
  [OID.date]: (value: string): string => value,
} satisfies { [pgType: number]: (value: string) => unknown };

/** The PGlite half: a whole Postgres in this process, one connection, transactions queued. */
export async function pgliteDb(dataDir?: string): Promise<Db> {
  const db = new PGlite({ dataDir, parsers: pgliteParsers });
  await db.waitReady;
  return new PgliteDb(db);
}

class PgliteDb implements Db {
  constructor(private readonly db: PGlite) {}

  async query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = params === undefined ? await this.db.query(sql) : await this.db.query(sql, params);
    return pgliteRow(result.rows, result.fields) as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async tx<T>(fn: (q: Db) => Promise<T>): Promise<T> {
    // PGlite is one connection: concurrent transactions run one after the other, whole, which is a
    // slower answer to concurrency than `for update` but the same one.
    return this.db.transaction(async (tx) => fn(new PgliteTxDb(tx)));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

class PgliteTxDb implements Db {
  constructor(private readonly outer: Transaction) {}

  async query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = params === undefined ? await this.outer.query(sql) : await this.outer.query(sql, params);
    return pgliteRow(result.rows, result.fields) as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.outer.exec(sql);
  }

  tx<T>(): Promise<T> {
    return Promise.reject(new Error("nested Db.tx on PGlite: the transaction's `q` is the whole of what a stage may use"));
  }

  close(): Promise<void> {
    return Promise.reject(new Error("close(): a transaction closes when the database does"));
  }
}
