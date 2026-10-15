-- Card Catalog & Inventory Service: PostgreSQL schema (target: Supabase)
-- Draft derived from src/catalog/types.ts. Not yet wired into the application.
-- Run in the Supabase SQL editor (or as a migration). Idempotent where practical.

create table if not exists cards (
  id              text primary key check (id ~ '^[A-Za-z0-9._-]{1,40}$'),
  name            text not null,
  image_small     text not null,
  image_large     text not null,
  rarity          text not null check (rarity in ('common','rare','epic','legendary')),
  source_rarity   text,
  set_id          text not null,
  set_name        text not null,
  supertype       text not null,
  subtypes        text[] not null default '{}',
  types           text[] not null default '{}',
  hp              integer not null default 0 check (hp >= 0),
  attacks         jsonb not null default '[]',
  weaknesses      jsonb not null default '[]',
  retreat_cost    integer not null default 0 check (retreat_cost >= 0),
  artist          text
);
create index if not exists cards_set_id_idx on cards (set_id);
create index if not exists cards_rarity_idx on cards (rarity);

create table if not exists packs (
  id              text primary key,
  name            text not null,
  description     text not null default '',
  price_credits   integer not null check (price_credits >= 0),   -- whole baht (SERVICE_CONVENTIONS)
  cards_per_pack  integer not null check (cards_per_pack > 0),
  rates           jsonb not null,                                -- {"common":70,"rare":25,"epic":4,"legendary":1}
  set_ids         text[] not null default '{}',
  active          boolean not null default true,
  constraint packs_rates_keys check (rates ?& array['common','rare','epic','legendary'])
);

create table if not exists stock (
  card_id   text primary key references cards(id) on delete cascade,
  total     integer not null default 0 check (total >= 0),
  reserved  integer not null default 0 check (reserved >= 0),
  constraint stock_reserved_le_total check (reserved <= total)
);

create table if not exists reservations (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  items            jsonb not null,                               -- [{"cardId":"base1-23","qty":1}]
  status           text not null check (status in ('reserved','committed','released','expired')),
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists reservations_due_idx on reservations (expires_at) where status = 'reserved';

-- The service connects with the server-side DB role and enforces auth itself.
-- Enable RLS with no policies so the public anon/authenticated API keys cannot read or write these tables.
alter table cards        enable row level security;
alter table packs        enable row level security;
alter table stock        enable row level security;
alter table reservations enable row level security;
