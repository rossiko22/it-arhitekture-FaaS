// daily-cleanup — TIME event (pg_cron, daily).
//
// Deletes orphaned/stale temp receipts: receipt rows still in `pending` status
// and older than 24h that were never linked to an expense, plus their Storage
// objects.
//
// Invoked by pg_cron (see 0002_cron.sql). Deployed with --no-verify-jwt;
// protected by the shared-secret header.

import { handlePreflight, json } from "../_shared/cors.ts";
import { assertWebhookSecret, serviceClient } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    assertWebhookSecret(req);
    const db = serviceClient();

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stale, error } = await db
      .from("receipts")
      .select("id, storage_path")
      .eq("status", "pending")
      .is("expense_id", null)
      .lt("created_at", cutoff);
    if (error) throw error;

    const rows = stale ?? [];
    if (rows.length > 0) {
      const paths = rows.map((r) => r.storage_path).filter(Boolean);
      if (paths.length) await db.storage.from("receipts").remove(paths);
      await db
        .from("receipts")
        .delete()
        .in("id", rows.map((r) => r.id));
    }

    return json({ ok: true, removed: rows.length });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
