-- ============================================================================
-- ReceiptVault — scheduled jobs (TIME event) + queue worker scheduling.
--
-- These pg_cron jobs invoke Edge Functions over HTTP using pg_net. Each call
-- carries the shared secret header (x-webhook-secret) that the event functions
-- validate, so the functions can be deployed with --no-verify-jwt.
--
-- HOW TO USE
-- ----------
-- The base URL and secret differ per environment. Set them once as Postgres
-- settings *before* this migration runs (or edit the values inline):
--
--   -- Local:
--   alter database postgres set app.functions_base_url = 'http://host.docker.internal:54321/functions/v1';
--   alter database postgres set app.webhook_secret      = 'local-dev-secret';
--
--   -- Hosted (run in the SQL editor once):
--   alter database postgres set app.functions_base_url = 'https://<ref>.supabase.co/functions/v1';
--   alter database postgres set app.webhook_secret      = '<your WEBHOOK_SECRET>';
--
-- If you prefer the Dashboard, you can instead create these schedules under
-- Integrations → Cron and skip this file.
-- ============================================================================

-- pg_cron is non-relocatable; it installs into its own fixed `cron` schema.
create extension if not exists pg_cron;

-- Helper: POST to an Edge Function with the shared secret header.
create or replace function public.invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base   text := current_setting('app.functions_base_url', true);
  secret text := current_setting('app.webhook_secret', true);
  req_id bigint;
begin
  if base is null then
    raise exception 'app.functions_base_url is not set';
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

-- Drain the notifications queue every minute. -------------------------------
select cron.schedule(
  'notification-worker-every-minute',
  '* * * * *',
  $$ select public.invoke_edge_function('notification-worker'); $$
);

-- Daily cleanup of orphaned temp receipts at 00:15. -------------------------
select cron.schedule(
  'daily-cleanup-midnight',
  '15 0 * * *',
  $$ select public.invoke_edge_function('daily-cleanup'); $$
);

-- Monthly digest on the 1st of each month at 06:00. -------------------------
select cron.schedule(
  'monthly-digest',
  '0 6 1 * *',
  $$ select public.invoke_edge_function('monthly-digest'); $$
);

-- NOTE on the pgmq queue:
-- The queue itself is created in 0001_init.sql via pgmq.create('notifications').
-- The on-user-created / on-expense-change functions enqueue messages with
-- pgmq.send(); the notification-worker reads them with pgmq.read() and
-- archives them with pgmq.archive(). No extra schema is needed here.
