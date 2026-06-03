// reports-api — JWT-protected monthly summary.
//
//   GET /reports-api?month=YYYY-MM   (defaults to the current month)
//   -> { month, total, count, by_category, budget: { monthly_limit, remaining, exceeded } }

import { handlePreflight, json } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

    const { client, userId } = await requireUser(req);
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return json({ error: "month must be YYYY-MM" }, 400);
    }

    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    const { data: rows, error } = await client
      .from("expenses")
      .select("amount, category")
      .gte("spent_at", start)
      .lt("spent_at", next);
    if (error) throw error;

    let total = 0;
    const byCategory: Record<string, number> = {};
    for (const r of rows ?? []) {
      const amt = Number(r.amount);
      total += amt;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + amt;
    }
    total = Math.round(total * 100) / 100;

    // Budget status (one budget row per user).
    const { data: budget } = await client
      .from("budgets")
      .select("monthly_limit, currency")
      .eq("user_id", userId)
      .maybeSingle();

    const limit = budget ? Number(budget.monthly_limit) : null;

    return json({
      month,
      total,
      count: rows?.length ?? 0,
      by_category: byCategory,
      budget: {
        monthly_limit: limit,
        currency: budget?.currency ?? "EUR",
        remaining: limit != null ? Math.round((limit - total) * 100) / 100 : null,
        exceeded: limit != null ? total > limit : false,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
