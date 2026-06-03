// monthly-digest — TIME event (pg_cron, monthly).
//
// Builds a per-user summary for the *previous* month and enqueues a digest
// email for each user with activity.
//
// Invoked by pg_cron on the 1st of each month (see 0002_cron.sql). Deployed
// with --no-verify-jwt; protected by the shared-secret header.

import { handlePreflight, json } from "../_shared/cors.ts";
import { assertWebhookSecret, serviceClient } from "../_shared/auth.ts";

/** Returns { month: 'YYYY-MM', start, next } for the previous calendar month. */
function previousMonth(): { month: string; start: string; next: string } {
  const now = new Date();
  const firstOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = start.toISOString().slice(0, 7);
  return {
    month,
    start: start.toISOString().slice(0, 10),
    next: firstOfThis.toISOString().slice(0, 10),
  };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    assertWebhookSecret(req);
    const db = serviceClient();
    const { month, start, next } = previousMonth();

    // Pull every expense in the window, then aggregate per user in code.
    const { data: rows, error } = await db
      .from("expenses")
      .select("user_id, amount")
      .gte("spent_at", start)
      .lt("spent_at", next);
    if (error) throw error;

    const perUser = new Map<string, { total: number; count: number }>();
    for (const r of rows ?? []) {
      const agg = perUser.get(r.user_id) ?? { total: 0, count: 0 };
      agg.total += Number(r.amount);
      agg.count += 1;
      perUser.set(r.user_id, agg);
    }

    // Look up emails for the active users.
    const userIds = [...perUser.keys()];
    let emails = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profiles } = await db
        .from("profiles")
        .select("id, email")
        .in("id", userIds);
      emails = new Map((profiles ?? []).map((p) => [p.id, p.email]));
    }

    let enqueued = 0;
    for (const [userId, agg] of perUser) {
      await db.rpc("queue_send", {
        queue_name: "notifications",
        msg: {
          kind: "monthly_digest",
          user_id: userId,
          email: emails.get(userId) ?? null,
          month,
          total: Math.round(agg.total * 100) / 100,
          count: agg.count,
        },
      });
      enqueued++;
    }

    return json({ ok: true, month, users: enqueued });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
