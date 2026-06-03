// Shared auth/client helpers used by every Edge Function.
//
// Two client factories:
//  - userClient(req): a Supabase client scoped to the caller's JWT. RLS applies,
//    so it can only see the caller's own rows. Used by HTTP API functions.
//  - serviceClient(): a service-role client that bypasses RLS. Used by
//    event-driven functions (webhook/cron/queue) that must act across users.
//
// Plus assertWebhookSecret() for event functions deployed with --no-verify-jwt.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Extract the raw Bearer token from the Authorization header, or null. */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Build a Supabase client that forwards the caller's JWT, then resolve the
 * authenticated user. Throws an Error with `.status = 401` if not authenticated.
 */
export async function requireUser(
  req: Request,
): Promise<{ client: SupabaseClient; userId: string; email: string | null }> {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error("Missing Authorization bearer token") as Error & { status: number };
    err.status = 401;
    throw err;
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    const err = new Error("Invalid or expired token") as Error & { status: number };
    err.status = 401;
    throw err;
  }

  return { client, userId: data.user.id, email: data.user.email ?? null };
}

/** Service-role client that bypasses RLS — for event-driven functions only. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Validate the shared-secret header on event functions. Throws an Error with
 * `.status = 401` if the secret is missing or wrong.
 *
 * Auth/Storage hooks and Database Webhooks can be configured to send this
 * header; pg_cron sends it via invoke_edge_function().
 */
export function assertWebhookSecret(req: Request): void {
  const expected = Deno.env.get("WEBHOOK_SECRET");
  // If no secret is configured (pure local dev), don't block.
  if (!expected) return;

  const got = req.headers.get("x-webhook-secret");
  if (got !== expected) {
    const err = new Error("Invalid webhook secret") as Error & { status: number };
    err.status = 401;
    throw err;
  }
}
