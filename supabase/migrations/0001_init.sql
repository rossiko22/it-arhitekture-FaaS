-- ============================================================================
-- ReceiptVault — initial schema
-- Tables: profiles, budgets, expenses, receipts, audit_log, notifications_sent
-- Plus: Row Level Security on every table, the pgmq "notifications" queue,
-- and supporting indexes.
-- This migration is written to be idempotent where reasonable.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
-- pgcrypto lives in the shared `extensions` schema (pre-installed on Supabase).
create extension if not exists pgcrypto with schema extensions;      -- gen_random_uuid()
-- pg_net and pgmq are non-relocatable: they install into their own fixed
-- schemas (`net` and `pgmq`), so no `with schema` clause is allowed.
create extension if not exists pg_net;                               -- net.http_post (cron → functions)
create extension if not exists pgmq;                                 -- pgmq.* message queue

-- ----------------------------------------------------------------------------
-- profiles: one row per auth user (created by the on-user-created function)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- budgets: monthly spending limit per user (one "default" row per user)
-- ----------------------------------------------------------------------------
create table if not exists public.budgets (
  id             uuid primary key default extensions.gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  monthly_limit  numeric(12,2) not null default 500.00,
  currency       text not null default 'EUR',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id)
);

-- ----------------------------------------------------------------------------
-- expenses: the core CRUD entity
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric(12,2) not null check (amount >= 0),
  currency    text not null default 'EUR',
  category    text not null default 'other',
  description text,
  spent_at    date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists expenses_user_idx        on public.expenses(user_id);
create index if not exists expenses_user_spent_idx   on public.expenses(user_id, spent_at);

-- ----------------------------------------------------------------------------
-- receipts: image metadata, linked to an expense
-- ----------------------------------------------------------------------------
create table if not exists public.receipts (
  id           uuid primary key default extensions.gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  expense_id   uuid references public.expenses(id) on delete set null,
  storage_path text not null,
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  status       text not null default 'pending',   -- pending | linked | orphaned
  created_at   timestamptz not null default now()
);

create index if not exists receipts_user_idx     on public.receipts(user_id);
create index if not exists receipts_expense_idx    on public.receipts(expense_id);
create index if not exists receipts_status_idx     on public.receipts(status);

-- ----------------------------------------------------------------------------
-- audit_log: written by the on-expense-change event function
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  entity      text not null,
  entity_id   text,
  action      text not null,             -- INSERT | UPDATE | DELETE
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_user_idx on public.audit_log(user_id);

-- ----------------------------------------------------------------------------
-- notifications_sent: fallback "outbox" when no email provider key is set
-- ----------------------------------------------------------------------------
create table if not exists public.notifications_sent (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  channel     text not null default 'email',
  kind        text not null,             -- welcome | budget_alert | monthly_digest
  payload     jsonb,
  delivered   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_sent_user_idx on public.notifications_sent(user_id);

-- ----------------------------------------------------------------------------
-- pgmq queue used by the notification-worker
-- ----------------------------------------------------------------------------
select pgmq.create('notifications');

-- public wrappers so Edge Functions can use the queue via supabase-js rpc()
-- without depending on whether the `pgmq` schema is exposed to the API.
-- (SECURITY DEFINER; only the service role calls these from event functions.)
create or replace function public.queue_send(queue_name text, msg jsonb)
returns bigint
language sql
security definer
set search_path = public, pgmq
as $$ select pgmq.send(queue_name, msg); $$;

create or replace function public.queue_read(queue_name text, vt int default 30, qty int default 10)
returns setof pgmq.message_record
language sql
security definer
set search_path = public, pgmq
as $$ select * from pgmq.read(queue_name, vt, qty); $$;

create or replace function public.queue_archive(queue_name text, msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$ select pgmq.archive(queue_name, msg_id); $$;

-- Only the service role may touch the queue (event functions). Revoke from
-- anon/authenticated so end users can't enqueue/read directly.
revoke all on function public.queue_send(text, jsonb)        from anon, authenticated;
revoke all on function public.queue_read(text, int, int)     from anon, authenticated;
revoke all on function public.queue_archive(text, bigint)    from anon, authenticated;

-- ============================================================================
-- Row Level Security
-- Every table is locked down; users may only touch their own rows.
-- The service role (used by event functions) bypasses RLS automatically.
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.budgets             enable row level security;
alter table public.expenses            enable row level security;
alter table public.receipts            enable row level security;
alter table public.audit_log           enable row level security;
alter table public.notifications_sent  enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- budgets
drop policy if exists "budgets_select_own" on public.budgets;
create policy "budgets_select_own" on public.budgets
  for select using (auth.uid() = user_id);
drop policy if exists "budgets_modify_own" on public.budgets;
create policy "budgets_modify_own" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- expenses
drop policy if exists "expenses_select_own" on public.expenses;
create policy "expenses_select_own" on public.expenses
  for select using (auth.uid() = user_id);
drop policy if exists "expenses_modify_own" on public.expenses;
create policy "expenses_modify_own" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- receipts
drop policy if exists "receipts_select_own" on public.receipts;
create policy "receipts_select_own" on public.receipts
  for select using (auth.uid() = user_id);
drop policy if exists "receipts_modify_own" on public.receipts;
create policy "receipts_modify_own" on public.receipts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- audit_log: read-only for the owner; only service role inserts.
drop policy if exists "audit_select_own" on public.audit_log;
create policy "audit_select_own" on public.audit_log
  for select using (auth.uid() = user_id);

-- notifications_sent: read-only for the owner; only service role inserts.
drop policy if exists "notifications_select_own" on public.notifications_sent;
create policy "notifications_select_own" on public.notifications_sent
  for select using (auth.uid() = user_id);

-- ============================================================================
-- Storage bucket for receipt images (private; access via signed URLs).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Users may upload/read objects under a folder named after their user id:
--   receipts/<user_id>/<file>
drop policy if exists "receipts_storage_insert_own" on storage.objects;
create policy "receipts_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts_storage_select_own" on storage.objects;
create policy "receipts_storage_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
