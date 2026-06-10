-- ============================================================================
-- ReceiptVault — runtime config without custom GUCs.
--
-- Hosted Supabase forbids `alter database/role postgres set app.*` (the
-- postgres role lacks permission to set custom parameters), so the
-- current_setting('app.functions_base_url') approach from 0002/0003 fails.
--
-- Instead we keep the two values in a small table that the SECURITY DEFINER
-- invoker reads. RLS is enabled with no policies, so only the service role and
-- definer functions (which bypass RLS) can read the secret — anon/authenticated
-- users cannot.
--
-- After this migration runs, set the two rows once per environment:
--   insert into public.app_config (key, value) values
--     ('functions_base_url', 'https://<ref>.supabase.co/functions/v1'),
--     ('webhook_secret',     '<your WEBHOOK_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- ============================================================================

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- Lock it down: RLS on, no policies → unreachable by anon/authenticated.
alter table public.app_config enable row level security;

-- Redefine the invoker to read from app_config instead of current_setting().
-- Still fail-safe: if the base URL isn't set, warn and skip rather than block
-- the underlying signup / insert / upload.
create or replace function public.invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base   text;
  secret text;
  req_id bigint;
begin
  select value into base   from public.app_config where key = 'functions_base_url';
  select value into secret from public.app_config where key = 'webhook_secret';

  if base is null or base = '' then
    raise warning 'app_config.functions_base_url not set; skipping invoke of %', fn;
    return null;
  end if;

  select net.http_post(
    url     := base || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', coalesce(secret, '')
               ),
    body    := body
  ) into req_id;

  return req_id;
end;
$$;
