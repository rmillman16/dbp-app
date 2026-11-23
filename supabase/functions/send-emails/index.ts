// Supabase Edge Function: emails people their new notifications (22 Nov). Short notices only: what's
// waiting and a link into the app; no attachments, prices or documents. Sent from DBP's Microsoft 365
// mailbox through Microsoft Graph (IT sets this up: docs/questions-for-IT.md §2).
//
// Runs every couple of minutes (Supabase › Integrations › Cron) and is also nudged by the app straight
// after anything that creates a notification, so emails go within a minute.
//
// Sends each notification that: is addressed to one person, is one of the kinds below, hasn't been emailed,
// is still open, and is from the last 2 days (no backlog). Dated reminders (off-hire, dated 3 days before the
// hire ends; a task's "Remind me", 053) go on their day instead: due today or in the last 2 days, however
// long ago they were made. The person must have emails on (My details).
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

const KINDS = ["requisition_new", "requisition_query", "requisition_answer", "requisition_update", "off_hire_due", "access_request", "access_request_reply", "minutes_action", "task", "task_done", "task_reminder", "pqq_chase", "pqq_review", "pqq_expiry", "company_doc_expiry", "rfi_new", "rfi_answered", "rfi_chase", "submittal_new", "submittal_chase"];
// sent on their own day, not when they're made
const DATED = ["off_hire_due", "task_reminder", "pqq_chase", "pqq_review", "pqq_expiry", "company_doc_expiry"];

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

// Mondays only, once a week (rfi_report_log keeps count): each RFI manager gets their unanswered RFIs as a table.
// deno-lint-ignore no-explicit-any
async function weeklyRfiReport(db: any, getToken: () => Promise<string>, sender: string, appUrl: string) {
  const now = new Date();
  if (now.getUTCDay() !== 1) return 0;
  const week = now.toISOString().slice(0, 10);
  const claim = await db.from("rfi_report_log").insert({ week_start: week });
  if (claim.error) return 0; // already sent this week (or script 057 not run)
  const { data: rfis } = await db
    .from("rfis")
    .select("id, job_id, enquiry_id, number, title, trade, due_date, created_at, manager_id, jobs(job_no, code, name, status), enquiries(enquiry_no, status)")
    .eq("status", "open")
    .order("created_at");
  // a job's (not archived) or an estimate's (not lost)
  // deno-lint-ignore no-explicit-any
  const open = (rfis ?? []).filter((r: any) => r.manager_id && ((r.jobs && r.jobs.status !== "archived") || (r.enquiries && r.enquiries.status !== "lost")));
  // submittals still out for review (script 060): listed in the same email
  const { data: subs } = await db
    .from("submittals")
    .select("id, job_id, number, title, trade, due_date, submitted_at, created_at, manager_id, jobs(job_no, code, status)")
    .eq("status", "out")
    .order("created_at");
  // deno-lint-ignore no-explicit-any
  const openS = (subs ?? []).filter((s: any) => s.manager_id && s.jobs && s.jobs.status !== "archived");
  if (!open.length && !openS.length) return 0;
  // deno-lint-ignore no-explicit-any
  const ids = [...new Set([...open, ...openS].map((r: any) => r.manager_id as string))];
  const { data: people } = await db.from("profiles").select("id, email, full_name, email_notifications").in("id", ids);
  const token = await getToken();
  const cell = "padding:4px 8px";
  let sent = 0;
  for (const p of people ?? []) {
    if (!p.email || p.email_notifications === false) continue;
    // deno-lint-ignore no-explicit-any
    const mine = open.filter((r: any) => r.manager_id === p.id);
    // deno-lint-ignore no-explicit-any
    const mineS = openS.filter((s: any) => s.manager_id === p.id);
    if (!mine.length && !mineS.length) continue;
    const rows = mine
      // deno-lint-ignore no-explicit-any
      .map((r: any) => {
        const late = r.due_date && r.due_date < week;
        const days = Math.floor((now.getTime() - new Date(r.created_at).getTime()) / 86400000);
        const due = r.due_date ? r.due_date.split("-").reverse().join("/") : "–";
        const link = r.enquiry_id ? `${appUrl}/estimating/e/${r.enquiry_id}/rfis/${r.id}` : `${appUrl}/jobs/${r.job_id}/rfis/${r.id}`;
        const label = r.enquiry_id ? "E" + String(r.enquiries.enquiry_no).padStart(3, "0") : r.jobs.job_no + " " + r.jobs.code;
        return `<tr><td style="${cell}"><a href="${esc(link)}">${esc(label)} RFI ${r.number}</a></td><td style="${cell}">${esc(r.title)}</td><td style="${cell}">${esc(r.trade ?? "")}</td><td style="${cell}${late ? ";color:#c00;font-weight:600" : ""}">${due}${late ? " (overdue)" : ""}</td><td style="${cell}">${days} days</td></tr>`;
      })
      .join("");
    const sRows = mineS
      // deno-lint-ignore no-explicit-any
      .map((s: any) => {
        const late = s.due_date && s.due_date < week;
        const days = Math.floor((now.getTime() - new Date(s.submitted_at ?? s.created_at).getTime()) / 86400000);
        const due = s.due_date ? s.due_date.split("-").reverse().join("/") : "–";
        const link = `${appUrl}/jobs/${s.job_id}/submittals/${s.id}`;
        return `<tr><td style="${cell}"><a href="${esc(link)}">${esc(s.jobs.job_no + " " + s.jobs.code)} S${s.number}</a></td><td style="${cell}">${esc(s.title)}</td><td style="${cell}">${esc(s.trade ?? "")}</td><td style="${cell}${late ? ";color:#c00;font-weight:600" : ""}">${due}${late ? " (overdue)" : ""}</td><td style="${cell}">${days} days</td></tr>`;
      })
      .join("");
    const head = (label: string) => `<tr style="background:#eef2ff;text-align:left"><th style="${cell}">${label}</th><th style="${cell}">Title</th><th style="${cell}">Trade</th><th style="${cell}">Due</th><th style="${cell}">Open for</th></tr>`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f1d2b">${
      mine.length ? `<p style="font-size:17px;font-weight:600">Your unanswered RFIs (${mine.length})</p><table style="border-collapse:collapse">${head("RFI")}${rows}</table>` : ""
    }${
      mineS.length ? `<p style="font-size:17px;font-weight:600">Your submittals out for review (${mineS.length})</p><table style="border-collapse:collapse">${head("Submittal")}${sRows}</table>` : ""
    }<p style="font-size:12px;color:#777">Weekly list from the DBP app. Open one to chase it or record the response.</p></div>`;
    const parts = [mine.length ? `${mine.length} unanswered RFI${mine.length === 1 ? "" : "s"}` : "", mineS.length ? `${mineS.length} submittal${mineS.length === 1 ? "" : "s"} out for review` : ""].filter(Boolean).join(" and ");
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { subject: `DBP app: your ${parts}`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: p.email } }] },
        saveToSentItems: false,
      }),
    });
    if (r.ok) sent++;
  }
  return sent;
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

    // RFI chasing (script 057): puts due chases on the bell and queues outside people's; runs even before email is set up
    try {
      await db.rpc("rfi_chase_tick");
    } catch {
      /* script 057 not run yet */
    }
    try {
      await db.rpc("submittal_chase_tick"); // script 060
    } catch {
      /* script 060 not run yet */
    }

    const tenant = Deno.env.get("MS_TENANT_ID"), client = Deno.env.get("MS_CLIENT_ID"), secret = Deno.env.get("MS_CLIENT_SECRET");
    const sender = Deno.env.get("MAIL_SENDER"), appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    if (!tenant || !client || !secret || !sender || !appUrl) return reply({ ok: true, sent: 0, detail: "Email isn't set up yet (Microsoft 365 secrets missing): nothing sent." });

    // one Microsoft sign-in, made only when something needs sending
    let tokenCache: string | null = null;
    const token0 = async () => (tokenCache ??= await graphToken(tenant, client, secret));

    // Mondays: each RFI manager's list of unanswered RFIs, once a week
    let reports = 0;
    try {
      reports = await weeklyRfiReport(db, token0, sender, appUrl);
    } catch (e) {
      console.warn("weekly RFI report:", e instanceof Error ? e.message : e);
    }

    const since = new Date(Date.now() - 2 * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const cols = "id, profile_id, kind, title, detail, due_date, link, job_id, source_id";
    const [news, dated] = await Promise.all([
      db
        .from("notifications")
        .select(cols)
        .is("emailed_at", null)
        .not("profile_id", "is", null)
        .eq("status", "open")
        .in("kind", KINDS.filter((k) => !DATED.includes(k)))
        .gte("created_at", since)
        .order("created_at")
        .limit(50),
      db
        .from("notifications")
        .select(cols)
        .is("emailed_at", null)
        .not("profile_id", "is", null)
        .eq("status", "open")
        .in("kind", DATED)
        .lte("due_date", today)
        .gte("due_date", since.slice(0, 10))
        .order("due_date")
        .limit(50),
    ]);
    const error = news.error ?? dated.error;
    if (error) return reply({ ok: false, detail: error.message });
    const ready = [...(news.data ?? []), ...(dated.data ?? [])];
    if (ready.length === 0) return reply({ ok: true, sent: 0 });

    const ids = [...new Set(ready.map((n) => n.profile_id as string))];
    const { data: people } = await db.from("profiles").select("id, email, email_notifications").in("id", ids);
    const who = new Map((people ?? []).map((p) => [p.id, p]));

    const token = await token0();
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
    return reply({ ok: failures.length === 0, sent, reports, failures });
  } catch (e) {
    return reply({ ok: false, detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
