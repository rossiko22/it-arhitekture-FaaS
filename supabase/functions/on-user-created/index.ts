// on-user-created — USER EVENT (Auth).
//
// Triggered on new signup. Inserts a `profiles` row + default `budgets` row
// and enqueues a welcome notification onto the pgmq `notifications` queue.
//
// Wire it as an Auth Hook ("after user created") or a trigger on auth.users
// that calls this function. The payload shape follows Supabase Auth hooks:
//   { type, record: { id, email, ... } }  (Database-Webhook style)
// We also accept a plain { user_id, email } body for flexibility.
//
// Deployed with --no-verify-jwt; protected by the shared-secret header.

import { handlePreflight, json } from "../_shared/cors.ts";
import { assertWebhookSecret, serviceClient } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    assertWebhookSecret(req);
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const payload = await req.json().catch(() => ({}));
    const record = payload.record ?? payload.user ?? payload;
    const userId: string | undefined = record.id ?? payload.user_id;
    const email: string | null = record.email ?? payload.email ?? null;

    if (!userId) return json({ error: "missing user id in payload" }, 400);

    const db = serviceClient();

    // Idempotent: upsert profile + default budget.
    const { error: pErr } = await db
      .from("profiles")
      .upsert({ id: userId, email }, { onConflict: "id" });
    if (pErr) throw pErr;

    const { error: bErr } = await db
      .from("budgets")
      .upsert({ user_id: userId, monthly_limit: 500.0 }, { onConflict: "user_id" });
    if (bErr) throw bErr;

    // Enqueue a welcome notification.
    const { error: qErr } = await db.rpc("queue_send", {
      queue_name: "notifications",
      msg: { kind: "welcome", user_id: userId, email },
    });
    if (qErr) throw qErr;

    return json({ ok: true, user_id: userId });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
