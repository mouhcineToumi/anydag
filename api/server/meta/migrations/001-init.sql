-- anydag-api's first schema. Applied by `PgMeta.migrate()` under an
-- advisory lock and recorded in `schema_migrations`. Never edit an applied migration: add 002.

create table plans (
  id text primary key,
  storage_bytes bigint,
  history_days integer,
  max_file_bytes bigint,
  devices integer
);
insert into plans (id) values ('free');

create table accounts (
  id text primary key,
  name text not null unique,
  plan text not null default 'free' references plans (id),
  created timestamptz not null default now()
);

create table devices (
  id text primary key,
  account text not null references accounts (id) on delete cascade,
  name text not null,
  platform text not null,
  token_sha256 text not null unique,
  created timestamptz not null default now(),
  seen date,
  revoked timestamptz
);
create index devices_account on devices (account);

create table pair_codes (
  code_sha256 text primary key,
  account text not null references accounts (id) on delete cascade,
  expires timestamptz not null,
  used timestamptz
);

create table vaults (
  id text primary key,
  account text not null references accounts (id) on delete cascade,
  name_sealed text not null,
  seq bigint not null default 0,
  horizon bigint not null default 1,
  created timestamptz not null default now()
);
create index vaults_account on vaults (account);

create table vault_keys (
  vault text primary key references vaults (id) on delete cascade,
  wrapped text not null,
  recovery text not null,
  params jsonb not null,
  etag text not null
);

create table blobs (
  vault text not null references vaults (id) on delete cascade,
  id text not null,
  size bigint not null,
  created timestamptz not null default now(),
  primary key (vault, id)
);

create table heads (
  vault text not null references vaults (id) on delete cascade,
  key text not null,
  seq bigint not null,
  blob text,
  size bigint not null default 0,
  meta_sealed text not null,
  primary key (vault, key)
);

create table log (
  vault text not null references vaults (id) on delete cascade,
  seq bigint not null,
  key text not null,
  parent bigint,
  blob text,
  size bigint not null default 0,
  meta_sealed text not null,
  device text not null,
  at timestamptz not null,
  primary key (vault, seq)
);
create index log_key on log (vault, key, seq);
create index log_blob on log (vault, blob) where blob is not null;

create table usage_daily (
  day date not null,
  account text not null,
  vault text not null default '',
  metric text not null,
  value bigint not null default 0,
  primary key (day, account, vault, metric)
);
create index usage_account on usage_daily (account, day);
