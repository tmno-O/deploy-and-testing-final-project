-- Trading Card Gacha Platform: single PostgreSQL database (Supabase), shared by all five services.
-- Idempotent (create ... if not exists): safe to run repeatedly.  Apply with: (cd card-catalog-service && npm run db:migrate)
--
-- Ownership (each table is written ONLY by its owning service; others go through that service's API):
--   user-service        users, addresses
--   wallet-service      wallets, wallet_transactions
--   card-catalog        cards, packs, stock, reservations
--   gacha-service       gacha_pulls, gacha_pull_cards
--   collection-service  collections, collection_pulls, orders, order_items, order_status_history
--
-- Foreign keys: rows that belong to a user reference users(id). Current catalog rows (packs) are referenced by
-- wallet_transactions / gacha_pulls. Historical rows that must outlive a catalog change (collections, orders, pull
-- cards) keep a snapshot of card name/rarity/image and have NO foreign key to cards, so an admin can delete a card
-- without rewriting history. Money is whole baht stored as integer (SERVICE_CONVENTIONS.md).

-- ============================== user-service ==============================

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,
  first_name     text not null,
  last_name      text not null,
  display_name   text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint users_email_lower check (email = lower(email))
);
create unique index if not exists users_email_key on users (email);

create table if not exists addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  recipient_name  text not null,
  phone           text not null,
  line1           text not null,
  line2           text,
  subdistrict     text,
  district        text not null,
  province        text not null,
  postal_code     text not null check (postal_code ~ '^[0-9]{5}$'),
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists addresses_user_idx on addresses (user_id);
-- at most one default address per user
create unique index if not exists addresses_one_default_idx on addresses (user_id) where is_default;

-- ============================ card-catalog-service ============================

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
  id              text primary key check (id ~ '^[A-Za-z0-9._-]{1,40}$'),
  name            text not null,
  description     text not null default '',
  price_credits   integer not null check (price_credits >= 0),
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

-- Short-lived holds on stock (default 10 min TTL). Settled rows are pruned after 24 h, so nothing references them by FK.
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

-- ============================== wallet-service ==============================

create table if not exists wallets (
  user_id     uuid primary key references users(id) on delete cascade,
  balance     integer not null default 0 check (balance >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Append-only ledger: rows are never updated or deleted (enforced by the trigger below).
create table if not exists wallet_transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references wallets(user_id),
  type             text not null check (type in ('topup','purchase','charge','refund')),
  direction        text not null check (direction in ('credit','debit')),
  amount           integer not null check (amount > 0),
  balance_before   integer not null check (balance_before >= 0),
  balance_after    integer not null check (balance_after >= 0),
  idempotency_key  text not null,
  request_hash     text not null,
  reason           text,
  pack_id          text references packs(id),
  refund_of        uuid references wallet_transactions(id),
  method           text,
  provider         text,
  provider_ref     text,
  created_at       timestamptz not null default now(),
  constraint wallet_tx_unique_key unique (user_id, idempotency_key),
  constraint wallet_tx_direction check (
    (type in ('topup','refund') and direction = 'credit') or (type in ('purchase','charge') and direction = 'debit')
  ),
  constraint wallet_tx_balance check (
    (direction = 'credit' and balance_after = balance_before + amount) or
    (direction = 'debit'  and balance_after = balance_before - amount)
  )
);
create index if not exists wallet_tx_user_time_idx on wallet_transactions (user_id, created_at desc);

create or replace function wallet_transactions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'wallet_transactions is append-only';
end $$;
drop trigger if exists wallet_transactions_no_change on wallet_transactions;
create trigger wallet_transactions_no_change before update or delete on wallet_transactions
  for each row execute function wallet_transactions_immutable();

-- ============================== gacha-service ===============================

-- PENDING = stock reserved, PAID = credits charged, COMPLETED = cards in the collection, FAILED = rolled back
create table if not exists gacha_pulls (
  id                     uuid primary key,                       -- pullId, generated by the service
  user_id                uuid not null references users(id),
  pack_id                text not null references packs(id),
  status                 text not null check (status in ('PENDING','PAID','COMPLETED','FAILED')),
  price                  integer check (price >= 0),
  reservation_id         uuid,                                   -- no FK: reservations are pruned after 24 h
  wallet_transaction_id  uuid references wallet_transactions(id),
  failure_reason         text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists gacha_pulls_user_time_idx on gacha_pulls (user_id, created_at desc);

create table if not exists gacha_pull_cards (
  pull_id             uuid not null references gacha_pulls(id) on delete cascade,
  position            smallint not null check (position >= 0),
  card_id             text not null,                             -- snapshot, no FK (see header)
  card_name           text not null,
  rarity              text not null check (rarity in ('common','rare','epic','legendary')),
  image_url           text not null,
  collection_pull_id  uuid not null unique,                      -- idempotency id sent to collection-service
  delivered           boolean not null default false,
  primary key (pull_id, position)
);

-- =========================== collection-service ============================

create table if not exists collections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  card_id            text not null,                              -- snapshot, no FK (see header)
  card_name          text not null,
  card_rarity        text not null check (card_rarity in ('common','rare','epic','legendary')),
  card_image_url     text not null,
  quantity           integer not null check (quantity >= 0),
  redeemed_quantity  integer not null default 0 check (redeemed_quantity >= 0),   -- held by non-cancelled orders
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint collections_user_card unique (user_id, card_id),
  constraint collections_redeemed_le_quantity check (redeemed_quantity <= quantity)
);

-- One row per Gacha card already added; makes "add card to collection" idempotent.
create table if not exists collection_pulls (
  pull_id     uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  card_id     text not null,
  quantity    integer not null check (quantity > 0),
  created_at  timestamptz not null default now()
);

create table if not exists orders (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references users(id),
  address_id               uuid references addresses(id) on delete set null,
  -- address snapshot: an order keeps its destination even if the address is later edited or deleted
  ship_recipient_name      text not null,
  ship_phone               text not null,
  ship_line1               text not null,
  ship_line2               text,
  ship_subdistrict         text,
  ship_district            text not null,
  ship_province            text not null,
  ship_postal_code         text not null,
  shipping_fee             integer not null default 0 check (shipping_fee >= 0),
  status                   text not null default 'PENDING'
                           check (status in ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  tracking_number          text,
  payment_status           text not null default 'NOT_REQUIRED' check (payment_status in ('NOT_REQUIRED','PAID','REFUNDED')),
  payment_ref              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint orders_tracking_when_shipped check (status not in ('SHIPPED','DELIVERED') or tracking_number is not null)
);
create index if not exists orders_user_time_idx on orders (user_id, created_at desc);
create index if not exists orders_status_idx on orders (status);

create table if not exists order_items (
  order_id   uuid not null references orders(id) on delete cascade,
  card_id    text not null,                                      -- snapshot, no FK (see header)
  card_name  text not null,
  quantity   integer not null check (quantity > 0),
  primary key (order_id, card_id)
);

create table if not exists order_status_history (
  id        bigint generated always as identity primary key,
  order_id  uuid not null references orders(id) on delete cascade,
  status    text not null check (status in ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  at        timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on order_status_history (order_id, at);

-- ================================ security =================================
-- Services connect with the database role (bypasses RLS) and enforce auth themselves. RLS with no policies means the
-- public Supabase anon / authenticated API keys can read or write nothing.
alter table users                 enable row level security;
alter table addresses             enable row level security;
alter table cards                 enable row level security;
alter table packs                 enable row level security;
alter table stock                 enable row level security;
alter table reservations          enable row level security;
alter table wallets               enable row level security;
alter table wallet_transactions   enable row level security;
alter table gacha_pulls           enable row level security;
alter table gacha_pull_cards      enable row level security;
alter table collections           enable row level security;
alter table collection_pulls      enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table order_status_history  enable row level security;
