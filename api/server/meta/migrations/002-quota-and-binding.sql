-- Sync protocol 2: what the storage quota counts, how much history a plan keeps, and the parent a
-- head's sealed metadata is bound to. Applied once by `PgMeta.migrate()`; never edit it: add 003.

-- A blob a commit has named. One that never was is "pending": counted against the quota, served
-- by nobody, and forgotten by the collector after the short window (`gc.ts`, `PENDING_MS`).
alter table blobs add column committed boolean not null default false;
update blobs b set committed = true
 where exists (select 1 from heads h where h.vault = b.vault and h.blob = b.id)
    or exists (select 1 from log l where l.vault = b.vault and l.blob = b.id);
create index blobs_pending on blobs (vault, created) where not committed;

-- Superseded history a plan keeps, in sealed bytes (null: as much as `storage_bytes`).
alter table plans add column history_bytes bigint;

-- A head's parent, so a device reading heads can check the sealed metadata against it as it
-- would a log row. A head's own log row is never compacted, so every head has one to copy.
alter table heads add column parent bigint;
update heads h set parent = l.parent from log l where l.vault = h.vault and l.seq = h.seq;
