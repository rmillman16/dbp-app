// Supabase Edge Function: emails people their new notifications (22 Nov). Short notices only: what's
// waiting and a link into the app; no attachments, prices or documents. Sent from DBP's Microsoft 365
// mailbox through Microsoft Graph (IT sets this up: docs/questions-for-IT.md §2).
//
// Runs every couple of minutes (Supabase › Integrations › Cron) and is also nudged by the app straight
// after anything that creates a notification, so emails go within a minute.
//
// Sends each notification that: is addressed to one person, is one of the kinds below, hasn't been emailed,
// is still open, is from the last 2 days (no backlog), and, for an off-hire reminder, is due today or
// earlier (it's dated 3 days before the hire ends). The person must have emails on (My details).
//
// Secrets (Supabase › Edge Functions › Secrets), from IT:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  the Microsoft app registration (Mail.Send, limited to the mailbox)
//   MAIL_SENDER                                   the mailbox emails come from, e.g. requisitions@duboulay.co.uk
//   APP_URL                                       the app's web address, e.g. https://app.duboulay.co.uk
//   CRON_SECRET                                   any long random text; the Cron job sends it as x-cron-secret
// Until they're set it sends nothing and says so; notifications stay on the bell as usual.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KINDS = ["requisition_new", "requisition_query", "requisition_answer", "requisition_update", "off_hire_due", "access_request", "access_request_reply"];

function serverKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const k = keys.default ?? Object.values(keys)[0];
      if (k) return k;
    } catch {
      /* fall through */
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function emailHtml(title: string, detail: string | null, link: string) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b;max-width:560px">
  <p style="font-size:17px;font-weight:600;margin:0 0 10px">${esc(title)}</p>
  ${detail ? `<p style="margin:0 0 16px;white-space:pre-wrap">${esc(detail)}</p>` : ""}
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#2b2257;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open in the DBP app</a></p>
  <p style="font-size:12px;color:#777;margin:0">Sent by the DBP app. To stop these emails, untick "Email me my notifications" in My details.</p>
</div>`;
}

async function graphToken(tenant: string, client: string, secret: string) {
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Microsoft sign-in failed: ${j.error_description ?? j.error ?? r.status}`);
  return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = serverKey();
    if (!key) return reply({ ok: false, detail: "The server key isn't available to this function." });
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // the Cron job (x-cron-secret) or a signed-in user of the app may run it; it only sends what's due
    const cronSecret = Deno.env.get("CRON_SECRET");
    const fromCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (!fromCron) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = await db.auth.getUser(token);
      if (!data?.user) return reply({ ok: false, detail: "Sign in first." }, 401);
    }

    const tenant = Deno.env.get("MS_TENANT_ID"), client = Deno.env.get("MS_CLIENT_ID"), secret = Deno.env.get("MS_CLIENT_SECRET");
    const sender = Deno.env.get("MAIL_SENDER"), appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    if (!tenant || !client || !secret || !sender || !appUrl) return reply({ ok: true, sent: 0, detail: "Email isn't set up yet (Microsoft 365 secrets missing): nothing sent." });

    const since = new Date(Date.now() - 2 * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const { data: due, error } = await db
      .from("notifications")
      .select("id, profile_id, kind, title, detail, due_date, link, job_id, source_id")
      .is("emailed_at", null)
      .not("profile_id", "is", null)
      .eq("status", "open")
      .in("kind", KINDS)
      .gte("created_at", since)
      .order("created_at")
      .limit(50);
    if (error) return reply({ ok: false, detail: error.message });
    const ready = (due ?? []).filter((n) => n.kind !== "off_hire_due" || (n.due_date && n.due_date <= today));
    if (ready.length === 0) return reply({ ok: true, sent: 0 });

    const ids = [...new Set(ready.map((n) => n.profile_id as string))];
    const { data: people } = await db.from("profiles").select("id, email, email_notifications").in("id", ids);
    const who = new Map((people ?? []).map((p) => [p.id, p]));

    const token = await graphToken(tenant, client, secret);
    let sent = 0;
    const failures: string[] = [];
    for (const n of ready) {
      const p = who.get(n.profile_id);
      // no email address or emails turned off: mark it so it isn't looked at again
      if (!p?.email || p.email_notifications === false) {
        await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
        continue;
      }
      const link = appUrl + (n.link ?? (n.job_id ? `/jobs/${n.job_id}` : "/"));
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: `DBP app: ${n.title}`,
            body: { contentType: "HTML", content: emailHtml(n.title, n.detail, link) },
            toRecipients: [{ emailAddress: { address: p.email } }],
          },
          saveToSentItems: false,
        }),
      });
      if (r.ok) {
        await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
        sent++;
      } else {
        const t = await r.text();
        failures.push(`${p.email}: ${r.status} ${t.slice(0, 200)}`);
      }
    }
    return reply({ ok: failures.length === 0, sent, failures });
  } catch (e) {
    return reply({ ok: false, detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
