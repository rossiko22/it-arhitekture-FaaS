-- ============================================================================
-- ReceiptVault — event wiring as database triggers.
--
-- Instead of configuring webhooks by hand in the Dashboard, we wire the three
-- event sources in SQL so everything is reproducible from this repo:
--   * auth.users        INSERT            -> on-user-created      (USER event)
--   * public.expenses   INS/UPD/DEL       -> on-expense-change    (DATA CHANGE)
--   * storage.objects   INSERT (receipts) -> on-receipt-uploaded  (STORAGE event)
--
-- Each trigger calls public.invoke_edge_function(), which POSTs to the Edge
-- Function over HTTP (pg_net) with the shared-secret header. The payloads match
-- the Supabase Database-Webhook shape the functions already parse
-- ({ type, record, old_record }).
-- ============================================================================

-- Make the invoker fail-safe: if the function URL isn't configured yet, do
-- nothing instead of raising — so a missing setting can never block a real
-- signup / insert / upload. (Redefines the version from 0002_cron.sql.)
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
  if base is null or base = '' then
    raise warning 'app.functions_base_url not set; skipping invoke of %', fn;
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

-- ---- USER event: new auth user --------------------------------------------
create or replace function public.tg_on_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.invoke_edge_function(
    'on-user-created',
    jsonb_build_object('type', 'INSERT', 'table', 'users', 'record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_on_user_created();

-- ---- DATA CHANGE event: expenses ------------------------------------------
create or replace function public.tg_on_expense_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.invoke_edge_function(
    'on-expense-change',
    jsonb_build_object(
      'type',       TG_OP,
      'table',      'expenses',
      'record',     case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
      'old_record', case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
    )
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists on_expense_change on public.expenses;
create trigger on_expense_change
  after insert or update or delete on public.expenses
  for each row execute function public.tg_on_expense_change();

-- ---- STORAGE event: uploads to the receipts bucket ------------------------
create or replace function public.tg_on_receipt_uploaded()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.bucket_id = 'receipts' then
    perform public.invoke_edge_function(
      'on-receipt-uploaded',
      jsonb_build_object('type', TG_OP, 'record', to_jsonb(NEW))
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_receipt_uploaded on storage.objects;
create trigger on_receipt_uploaded
  after insert on storage.objects
  for each row execute function public.tg_on_receipt_uploaded();
