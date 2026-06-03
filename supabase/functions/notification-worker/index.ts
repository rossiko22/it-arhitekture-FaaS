// notification-worker — MESSAGE/QUEUE event (pgmq).
//
// Reads messages from the `notifications` queue and "sends" them:
//   - if RESEND_API_KEY is set, sends a real email via Resend,
//   - otherwise logs the notification into `notifications_sent`.
// Successfully handled messages are archived from the queue.
//
// Invoked periodically by pg_cron (see 0002_cron.sql, every minute).
//
// Deployed with --no-verify-jwt; protected by the shared-secret header.

import { handlePreflight, json } from "../_shared/cors.ts";
import { assertWebhookSecret, serviceClient } from "../_shared/auth.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "ReceiptVault <onboarding@resend.dev>";
const BATCH = 10;

interface QueueMessage {
  msg_id: number;
  message: {
    kind: string;
    user_id: string;
    email?: string | null;
    [k: string]: unknown;
  };
}

function renderEmail(kind: string, m: Record<string, unknown>): { subject: string; html: string } {
  switch (kind) {
    case "welcome":
      return {
        subject: "Welcome to ReceiptVault 🧾",
        html: `<p>Welcome! Your account is ready. Start tracking expenses and uploading receipts.</p>`,
      };
    case "budget_alert":
      return {
        subject: `Budget exceeded for ${m.month}`,
        html: `<p>You've spent <b>${m.total} ${m.currency ?? ""}</b> this month, which is over your limit of <b>${m.monthly_limit} ${m.currency ?? ""}</b>.</p>`,
      };
    case "monthly_digest":
      return {
        subject: `Your ${m.month} expense summary`,
        html: `<p>Total spent in ${m.month}: <b>${m.total} ${m.currency ?? ""}</b> across ${m.count} expenses.</p>`,
      };
    default:
      return { subject: "ReceiptVault notification", html: `<pre>${JSON.stringify(m)}</pre>` };
  }
}

async function deliver(
  db: ReturnType<typeof serviceClient>,
  msg: QueueMessage["message"],
): Promise<void> {
  const { subject, html } = renderEmail(msg.kind, msg);

  let delivered = false;
  if (RESEND_API_KEY && msg.email) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: msg.email, subject, html }),
    });
    delivered = res.ok;
  }

  // Always record the notification (acts as an outbox / audit trail).
  await db.from("notifications_sent").insert({
    user_id: msg.user_id,
    channel: "email",
    kind: msg.kind,
    payload: msg,
    delivered,
  });
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    assertWebhookSecret(req);
    const db = serviceClient();

    // Read up to BATCH messages with a 30s visibility timeout.
    const { data: messages, error } = await db.rpc("queue_read", {
      queue_name: "notifications",
      vt: 30,
      qty: BATCH,
    });
    if (error) throw error;

    const list = (messages ?? []) as QueueMessage[];
    let processed = 0;

    for (const item of list) {
      try {
        await deliver(db, item.message);
        await db.rpc("queue_archive", {
          queue_name: "notifications",
          msg_id: item.msg_id,
        });
        processed++;
      } catch (innerErr) {
        // Leave the message on the queue for retry after the visibility timeout.
        console.error("failed to process message", item.msg_id, innerErr);
      }
    }

    return json({ ok: true, read: list.length, processed });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
