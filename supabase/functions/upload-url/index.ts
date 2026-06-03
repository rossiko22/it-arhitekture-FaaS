// upload-url — returns a signed upload URL for the private `receipts` bucket.
//
//   POST /upload-url   { file_name: string, expense_id?: string }
//   -> { path, token, signedUrl }
//
// The frontend uploads the file with supabase.storage.from('receipts')
// .uploadToSignedUrl(path, token, file). The object key is namespaced by user
// id (receipts/<user_id>/...) so Storage RLS and the on-receipt-uploaded
// handler can attribute it. expense_id is embedded in the path so the upload
// handler can link the receipt to its expense.

import { handlePreflight, json } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const { client, userId } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const fileName: string = body.file_name ?? `receipt-${Date.now()}.jpg`;
    const expenseId: string | undefined = body.expense_id;

    // Keep the key flat-ish but namespaced. Encode expense_id as a path segment
    // when present so the upload handler can recover it.
    const safeName = fileName.replace(/[^\w.\-]/g, "_");
    const path = expenseId
      ? `${userId}/exp_${expenseId}/${Date.now()}_${safeName}`
      : `${userId}/${Date.now()}_${safeName}`;

    const { data, error } = await client.storage
      .from("receipts")
      .createSignedUploadUrl(path);
    if (error) throw error;

    return json({ path, token: data.token, signedUrl: data.signedUrl });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
