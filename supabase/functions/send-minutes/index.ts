// Supabase Edge Function: emails issued meeting minutes (24 Nov). The app builds the PDF in the browser and sends it here with the
// people ticked in the "Email these minutes" check; this sends it from DBP's Microsoft 365 mailbox through Microsoft Graph, with
// the person who sent it copied in and set as reply-to, and the job's project hub link (jobs.hub_url, script 078) at the foot.
//
// Only a signed-in du Boulay Projects person (an @duboulay.co.uk login) may use it, up to 60 recipients and a 2.5 MB PDF, so it
// can't be used to send anything else. Same secrets as send-emails: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_SENDER.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = serverKey();
    if (!key) return reply({ ok: false, detail: "The server key isn't available to this function." });
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    const me = u?.user;
    if (!me?.email) return reply({ ok: false, detail: "Sign in first." }, 401);
    if (!/@duboulay\.co\.uk$/i.test(me.email)) return reply({ ok: false, detail: "Only du Boulay Projects people can email minutes." }, 403);

    const body = await req.json().catch(() => null);
    const to: string[] = Array.isArray(body?.to) ? [...new Set<string>(body.to.map((x: unknown) => String(x).trim().toLowerCase()))].filter((x) => EMAIL.test(x)) : [];
    if (!to.length) return reply({ ok: false, detail: "No recipients." });
    if (to.length > 60) return reply({ ok: false, detail: "Too many recipients (60 at most)." });
    const pdf = typeof body.pdf === "string" ? body.pdf : "";
    if (!pdf) return reply({ ok: false, detail: "The minutes PDF is missing." });
    if (pdf.length > 3_400_000) return reply({ ok: false, detail: "The PDF is too large to email (2.5 MB at most)." });
    const subject = String(body.subject ?? "").trim().slice(0, 200) || "Meeting minutes";
    const message = String(body.message ?? "").slice(0, 5000);
    const filename = String(body.filename ?? "minutes.pdf").replace(/[^\w .\-()]/g, "_").slice(0, 120) || "minutes.pdf";

    const tenant = Deno.env.get("MS_TENANT_ID"), client = Deno.env.get("MS_CLIENT_ID"), secret = Deno.env.get("MS_CLIENT_SECRET"), sender = Deno.env.get("MAIL_SENDER");
    if (!tenant || !client || !secret || !sender) return reply({ ok: false, detail: "Email isn't set up yet (the Microsoft 365 secrets are missing), so nothing was sent." });

    // the job's project hub link
    let hub: string | null = null;
    if (body.job_id) {
      const { data: j } = await db.from("jobs").select("hub_url").eq("id", String(body.job_id)).maybeSingle();
      hub = j?.hub_url ?? null;
    }
    const { data: p } = await db.from("profiles").select("full_name").eq("id", me.id).maybeSingle();
    const who = p?.full_name || me.email;

    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b;max-width:600px">
  <p style="margin:0 0 16px;white-space:pre-wrap">${esc(message)}</p>
  <p style="margin:0 0 16px">Kind regards,<br>${esc(who)}<br>du Boulay Projects Limited</p>
  ${hub ? `<p style="margin:0 0 14px;padding:10px 12px;background:#eef3fa;border-left:3px solid #007abe;font-size:13px"><b>Project hub:</b> <a href="${esc(hub)}" style="color:#007abe">drawings and project documents</a></p>` : ""}
  <p style="font-size:12px;color:#777;margin:0">The minutes are attached as a PDF. Reply to this email to reach ${esc(who)}.</p>
</div>`;

    const tr = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    });
    const tj = await tr.json();
    if (!tr.ok) return reply({ ok: false, detail: `Microsoft sign-in failed: ${tj.error_description ?? tj.error ?? tr.status}` });

    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: to.includes(me.email.toLowerCase()) ? [] : [{ emailAddress: { address: me.email } }],
          replyTo: [{ emailAddress: { address: me.email, name: who } }],
          attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: filename, contentType: "application/pdf", contentBytes: pdf }],
        },
        saveToSentItems: true,
      }),
    });
    if (!r.ok) return reply({ ok: false, detail: `The email wasn't sent: ${r.status} ${(await r.text()).slice(0, 200)}` });
    return reply({ ok: true, sent: to.length });
  } catch (e) {
    return reply({ ok: false, detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
