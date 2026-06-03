// expenses-api — JWT-protected CRUD over the `expenses` table.
//
//   GET    /expenses-api            list (optional ?month=YYYY-MM filter)
//   POST   /expenses-api            create  { amount, category, description?, spent_at?, currency? }
//   PUT    /expenses-api?id=<uuid>  update  (any of the above fields)
//   DELETE /expenses-api?id=<uuid>  delete
//
// All operations are scoped to the authenticated user via RLS.

import { handlePreflight, json } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const { client, userId } = await requireUser(req);
    const url = new URL(req.url);

    switch (req.method) {
      case "GET": {
        const month = url.searchParams.get("month"); // YYYY-MM
        let query = client
          .from("expenses")
          .select("*")
          .order("spent_at", { ascending: false });

        if (month && /^\d{4}-\d{2}$/.test(month)) {
          const start = `${month}-01`;
          // First day of the next month.
          const [y, m] = month.split("-").map(Number);
          const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
          query = query.gte("spent_at", start).lt("spent_at", next);
        }

        const { data, error } = await query;
        if (error) throw error;
        return json({ expenses: data });
      }

      case "POST": {
        const body = await req.json().catch(() => ({}));
        if (body.amount == null || isNaN(Number(body.amount))) {
          return json({ error: "amount is required and must be a number" }, 400);
        }
        const { data, error } = await client
          .from("expenses")
          .insert({
            user_id: userId,
            amount: Number(body.amount),
            currency: body.currency ?? "EUR",
            category: body.category ?? "other",
            description: body.description ?? null,
            spent_at: body.spent_at ?? new Date().toISOString().slice(0, 10),
          })
          .select()
          .single();
        if (error) throw error;
        return json({ expense: data }, 201);
      }

      case "PUT": {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id query param is required" }, 400);
        const body = await req.json().catch(() => ({}));

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const f of ["amount", "currency", "category", "description", "spent_at"]) {
          if (body[f] !== undefined) patch[f] = body[f];
        }

        const { data, error } = await client
          .from("expenses")
          .update(patch)
          .eq("id", id)
          .eq("user_id", userId)
          .select()
          .single();
        if (error) throw error;
        if (!data) return json({ error: "not found" }, 404);
        return json({ expense: data });
      }

      case "DELETE": {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id query param is required" }, 400);
        const { error } = await client
          .from("expenses")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        if (error) throw error;
        return json({ deleted: id });
      }

      default:
        return json({ error: "method not allowed" }, 405);
    }
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
