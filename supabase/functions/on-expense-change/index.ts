// on-expense-change — DATA CHANGE event (Database Webhook).
//
// Triggered on INSERT/UPDATE/DELETE of `expenses`. It:
//   1. writes an `audit_log` row,
//   2. recomputes the user's current-month total,
//   3. enqueues a budget-exceeded alert when the total passes the limit.
//
// Database Webhook payload (Supabase):
//   { type: "INSERT"|"UPDATE"|"DELETE", table, record, old_record }
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
    const action: string = payload.type ?? "UNKNOWN";
    const record = payload.record ?? {};
    const oldRecord = payload.old_record ?? {};
    const row = action === "DELETE" ? oldRecord : record;
    const userId: string | undefined = row.user_id;

    if (!userId) return json({ error: "missing user_id in payload" }, 400);

    const db = serviceClient();

    // 1. Audit log.
    await db.from("audit_log").insert({
      user_id: userId,
      entity: "expense",
      entity_id: String(row.id ?? ""),
      action,
      detail: { record, old_record: oldRecord },
    });

    // 2. Recompute current-month total.
    const month = new Date().toISOString().slice(0, 7);
    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    const { data: rows, error: sumErr } = await db
      .from("expenses")
      .select("amount")
      .eq("user_id", userId)
      .gte("spent_at", start)
      .lt("spent_at", next);
    if (sumErr) throw sumErr;

    const total = Math.round((rows ?? []).reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;

    // 3. Compare to budget; enqueue alert if exceeded.
    const { data: budget } = await db
      .from("budgets")
      .select("monthly_limit, currency")
      .eq("user_id", userId)
      .maybeSingle();

    let alerted = false;
    if (budget && total > Number(budget.monthly_limit)) {
      await db.rpc("queue_send", {
        queue_name: "notifications",
        msg: {
          kind: "budget_alert",
          user_id: userId,
          month,
          total,
          monthly_limit: Number(budget.monthly_limit),
          currency: budget.currency,
        },
      });
      alerted = true;
    }

    return json({ ok: true, action, month_total: total, alerted });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
