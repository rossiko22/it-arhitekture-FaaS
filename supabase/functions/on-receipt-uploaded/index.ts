// on-receipt-uploaded — STORAGE event.
//
// Triggered when an object is uploaded to the `receipts` bucket. It:
//   1. validates the file (type / size),
//   2. records a `receipts` row with metadata,
//   3. links it to the matching expense if the path encodes one
//      (receipts/<user_id>/exp_<expense_id>/<file>).
//
// Storage webhook payload (Supabase) is Database-Webhook style on
// storage.objects: { type, record: { name, bucket_id, metadata, owner } }.
//
// Deployed with --no-verify-jwt; protected by the shared-secret header.

import { handlePreflight, json } from "../_shared/cors.ts";
import { assertWebhookSecret, serviceClient } from "../_shared/auth.ts";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    assertWebhookSecret(req);
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const payload = await req.json().catch(() => ({}));
    const record = payload.record ?? payload;
    const bucket: string = record.bucket_id ?? record.bucket ?? "";
    const name: string = record.name ?? ""; // e.g. "<user_id>/exp_<id>/123_x.jpg"

    if (bucket !== "receipts") return json({ ok: true, skipped: "not receipts bucket" });
    if (!name) return json({ error: "missing object name" }, 400);

    const meta = record.metadata ?? {};
    const mime: string | null = meta.mimetype ?? meta.contentType ?? null;
    const size: number | null = meta.size != null ? Number(meta.size) : null;

    const segments = name.split("/");
    const userId = record.owner ?? segments[0] ?? null;
    const expMatch = segments[1]?.match(/^exp_(.+)$/);
    const expenseId = expMatch ? expMatch[1] : null;

    // 1. Validate.
    const db = serviceClient();
    if ((mime && !ALLOWED_TYPES.includes(mime)) || (size != null && size > MAX_BYTES)) {
      // Record as orphaned and remove the bad object.
      await db.from("receipts").insert({
        user_id: userId,
        storage_path: name,
        file_name: segments[segments.length - 1],
        mime_type: mime,
        size_bytes: size,
        status: "orphaned",
      });
      await db.storage.from("receipts").remove([name]);
      return json({ ok: false, reason: "validation failed (type/size)" }, 422);
    }

    // 2 + 3. Record metadata, link to expense if present.
    const { data, error } = await db
      .from("receipts")
      .insert({
        user_id: userId,
        expense_id: expenseId,
        storage_path: name,
        file_name: segments[segments.length - 1],
        mime_type: mime,
        size_bytes: size,
        status: expenseId ? "linked" : "pending",
      })
      .select()
      .single();
    if (error) throw error;

    return json({ ok: true, receipt: data });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
