// Supabase Edge Function: emails people their new notifications (22 Nov). Short notices only: what's
// waiting and a link into the app; no prices or documents, with one exception (24 Nov): when a requisition is set to Ordered, the buyer's order documents (receipt, order confirmation: requisition_files kind "order", script 075) are attached for the requester. Sent from DBP's Microsoft 365
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

const KINDS = ["requisition_new", "requisition_query", "requisition_answer", "requisition_update", "off_hire_due", "access_request", "access_request_reply", "minutes_action", "task", "task_done", "task_reminder", "pqq_chase", "pqq_review", "pqq_expiry", "company_doc_expiry", "rfi_new", "rfi_answered", "rfi_chase", "submittal_new", "submittal_chase", "submittal_response", "report_due", "rfi_followup", "hs_inspection_due", "hs_inspection_overdue", "minutes_action_due", "minutes_action_overdue"];
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

// The buyer's order documents for an ordered requisition (script 075), as Microsoft Graph file attachments. Graph takes about 4 MB in
// one request, so up to ~2.5 MB of files go on the email; any beyond that are named in the email and stay in the app.
// deno-lint-ignore no-explicit-any
async function orderDocuments(db: any, requisitionId: string) {
  const { data: r } = await db.from("requisitions").select("status").eq("id", requisitionId).maybeSingle();
  if (r?.status !== "ordered") return { attach: [] as unknown[], left: [] as string[] };
  const { data: files } = await db.from("requisition_files").select("path, name").eq("requisition_id", requisitionId).eq("kind", "order").order("created_at");
  const attach: unknown[] = [];
  const left: string[] = [];
  let total = 0;
  for (const f of files ?? []) {
    const dl = await db.storage.from("requisitions").download(f.path);
    if (dl.error || !dl.data) { left.push(f.name); continue; }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (total + bytes.length > 2_500_000) { left.push(f.name); continue; }
    total += bytes.length;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    attach.push({ "@odata.type": "#microsoft.graph.fileAttachment", name: f.name, contentType: dl.data.type || "application/octet-stream", contentBytes: btoa(bin) });
  }
  return { attach, left };
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

// The footer of every email to an outside person (script 078): the job's one project hub link (drawings and project documents).
const hubFooter = (url: string | null | undefined) =>
  url ? `<p style="margin:0 0 14px;padding:10px 12px;background:#eef3fa;border-left:3px solid #007abe;font-size:13px"><b>Project hub:</b> <a href="${esc(url)}" style="color:#007abe">drawings and project documents</a></p>` : "";

// The welcome email (script 078): when someone is added to a job's project directory, they get one email with the project hub link,
// whether or not they have any RFIs or submittals, so they can come back to it for the drawings. It waits until the job has a hub
// link (up to 30 days), skips du Boulay people, and goes once per email address per job.
// deno-lint-ignore no-explicit-any
async function sendWelcome(db: any, getToken: () => Promise<string>, sender: string) {
  const { data: rows, error } = await db.from("welcome_outbox").select("id, directory_id, job_id, created_at").is("sent_at", null).order("created_at").limit(20);
  if (error || !rows?.length) return 0; // none, or script 078 not run yet
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  let sent = 0;
  for (const o of rows) {
    const done = (email?: string) => db.from("welcome_outbox").update({ sent_at: new Date().toISOString(), ...(email ? { email } : {}) }).eq("id", o.id);
    if (o.created_at < old) { await done(); continue; }
    const { data: job } = await db.from("jobs").select("job_no, code, name, status, site_address, hub_url").eq("id", o.job_id).maybeSingle();
    if (!job || job.status === "archived") { await done(); continue; }
    if (!job.hub_url) continue; // no hub link yet: wait
    const { data: d } = await db.from("job_directory").select("contact_id, company_id, role").eq("id", o.directory_id).maybeSingle();
    if (!d) { await done(); continue; }
    const [c, co] = await Promise.all([
      d.contact_id ? db.from("contacts").select("name, email").eq("id", d.contact_id).maybeSingle() : Promise.resolve({ data: null }),
      d.company_id ? db.from("companies").select("name, email").eq("id", d.company_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const to = (c.data?.email || co.data?.email || "").trim();
    const name = c.data?.name ?? "";
    if (!to || /@duboulay\.co\.uk$/i.test(to)) { await done(); continue; }
    const again = await db.from("welcome_outbox").select("id").eq("job_id", o.job_id).eq("email", to.toLowerCase()).not("sent_at", "is", null).limit(1);
    if (again.data?.length) { await done(to.toLowerCase()); continue; }
    const project = `${job.job_no} ${job.name}`;
    const site = job.site_address ? String(job.site_address).replace(/\s*\n\s*/g, ", ") : "";
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b;max-width:560px">
  <p>${name ? "Dear " + esc(name.split(" ")[0]) + "," : "Hello,"}</p>
  <p>Welcome to <b>${esc(project)}</b>${site ? ` (${esc(site)})` : ""}. du Boulay Projects has added you to the project team${d.role ? ` as <b>${esc(d.role)}</b>` : ""}.</p>
  <p>Everything you need for the job is kept in one place, the project hub. Use it whenever you need the latest drawings and project documents, and keep this email so you can come back to it.</p>
  <p style="margin:0 0 20px"><a href="${esc(job.hub_url)}" style="background:#2b2257;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open the project hub</a></p>
  <p>If we need an answer from you (an RFI or a submittal to review) you will get a separate email with your own private link. You don't need an account for those.</p>
  <p>If anything is missing, contact your du Boulay Projects project manager.</p>
  <p style="font-size:12px;color:#777;margin:0">Sent by du Boulay Projects Limited. The hub link is for the people on this project: please don't forward it.</p>
</div>`;
    const token = await getToken();
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: `Welcome to ${project}`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }),
    });
    if (r.ok) { await done(to.toLowerCase()); sent++; }
  }
  return sent;
}

// Outside people's emails (script 061): each new RFI / submittal for review / chase queued in rfi_outbox / submittal_outbox is
// emailed to the outside person with their own private link (made now; only its hash is kept). They answer on that page:
// no login. Short and with no attachments, as every email here. Anything older than 3 days in the queue is dropped.
// deno-lint-ignore no-explicit-any
async function sendOutside(db: any, getToken: () => Promise<string>, sender: string, appUrl: string) {
  let sent = 0;
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  for (const kind of ["rfi", "submittal"] as const) {
    const box = kind === "rfi" ? "rfi_outbox" : "submittal_outbox";
    const idCol = kind === "rfi" ? "rfi_id" : "submittal_id";
    const people = kind === "rfi" ? "rfi_people" : "submittal_people";
    const { data: rows, error } = await db.from(box).select(`id, person_id, kind, created_at, ${idCol}`).is("sent_at", null).order("created_at").limit(20);
    if (error || !rows?.length) continue;
    for (const o of rows) {
      const done = () => db.from(box).update({ sent_at: new Date().toISOString() }).eq("id", o.id);
      if (o.created_at < old) { await done(); continue; }
      const { data: p } = await db.from(people).select("id, role, directory_id").eq("id", o.person_id).maybeSingle();
      if (!p || !p.directory_id) { await done(); continue; }
      const { data: d } = await db.from("job_directory").select("contact_id, company_id").eq("id", p.directory_id).maybeSingle();
      const [c, co] = await Promise.all([
        d?.contact_id ? db.from("contacts").select("name, email").eq("id", d.contact_id).maybeSingle() : Promise.resolve({ data: null }),
        d?.company_id ? db.from("companies").select("name, email").eq("id", d.company_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const to = (c.data?.email || co.data?.email || "").trim();
      const name = c.data?.name ?? co.data?.name ?? "";
      const itemRow = kind === "rfi"
        ? await db.from("rfis").select("id, job_id, number, title, status, due_date, jobs(name, hub_url)").eq("id", o[idCol]).maybeSingle()
        : await db.from("submittals").select("id, job_id, number, title, status, due_date, jobs(name, hub_url)").eq("id", o[idCol]).maybeSingle();
      const it = itemRow.data;
      const live = it && it.job_id && (kind === "rfi" ? ["open", "answered"].includes(it.status) : it.status === "out");
      if (!to || !live) { await done(); continue; }
      const tok = await db.rpc("external_make_link", { p_kind: kind, p_item: it.id, p_person: p.id, p_email: to, p_by: null, p_days: 90 });
      if (tok.error || !tok.data) continue;
      const link = `${appUrl}/r/${tok.data}`;
      const project = it.jobs?.name ?? "";
      const what = kind === "rfi" ? `RFI ${it.number}` : `Submittal ${it.number}`;
      const chase = o.kind === "chase";
      const followUp = o.kind === "follow_up"; // DBP replied to the assignee's answer: it is open again
      const ask = kind === "rfi"
        ? (followUp ? "has replied to your answer" : p.role === "assignee" ? "has asked you a question" : "has copied you in on a question")
        : (p.role === "reviewer" ? "has sent something for your review" : "has copied you in on a submittal");
      const due = it.due_date ? ` It is due by ${it.due_date.split("-").reverse().join("/")}.` : "";
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b;max-width:560px">
  <p>${name ? "Dear " + esc(name.split(" ")[0]) + "," : "Hello,"}</p>
  <p>${chase ? "A reminder: " : ""}du Boulay Projects ${ask} on <b>${esc(project)}</b>.</p>
  <p style="font-size:17px;font-weight:600;margin:0 0 6px">${esc(what)}: ${esc(it.title)}</p>
  <p style="margin:0 0 16px">${p.role === "cc" ? "It is for your information." : "Please open it to " + (kind === "rfi" ? "reply" : "respond") + ". You don't need an account."}${esc(due)}</p>
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#2b2257;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open ${esc(what)}</a></p>
  ${hubFooter(it.jobs?.hub_url)}
  <p style="font-size:12px;color:#777;margin:0">This link is for you: please don't forward it. If it stops working, ask du Boulay Projects for a new one.</p>
</div>`;
      const token = await getToken();
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { subject: `${chase ? "Reminder: " : followUp ? "Reply: " : ""}${project}: ${what} – ${it.title}`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }),
      });
      if (r.ok) { await done(); sent++; }
    }
  }
  return sent;
}

// Outside owners' actions from the minutes (script 085): what is queued in action_outbox (issued minutes, due soon, overdue) goes
// out as ONE email per person, listing their open actions, with their own private link (/a/<token>, made now; only its hash is
// kept, valid 90 days) where they tick them off. Anything older than 3 days in the queue is dropped.
// deno-lint-ignore no-explicit-any
async function sendActions(db: any, getToken: () => Promise<string>, sender: string, appUrl: string) {
  const { data: rows, error } = await db.from("action_outbox").select("id, point_id, email, kind, created_at").is("sent_at", null).order("created_at").limit(100);
  if (error || !rows?.length) return 0;
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  // deno-lint-ignore no-explicit-any
  const byEmail = new Map<string, any[]>();
  for (const r of rows) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
  let sent = 0;
  for (const [email, list] of byEmail) {
    const ids = list.map((r) => r.id);
    const done = () => db.from("action_outbox").update({ sent_at: new Date().toISOString() }).in("id", ids);
    if (list.every((r) => r.created_at < old)) { await done(); continue; }
    const { data: pts } = await db.from("meeting_points").select("id, meeting_id, text, due_date, done, is_action, carried_forward").in("id", [...new Set(list.map((r) => r.point_id))]);
    // deno-lint-ignore no-explicit-any
    const open = (pts ?? []).filter((p: any) => p.is_action && !p.done && !p.carried_forward);
    if (!open.length) { await done(); continue; }
    const mids = [...new Set(open.map((p: { meeting_id: string }) => p.meeting_id))] as string[];
    const [ms, ats] = await Promise.all([
      db.from("meetings").select("id, project, subtitle, meeting_date, meeting_no, jobs(name, status, hub_url)").in("id", mids),
      db.from("meeting_attendees").select("meeting_id, initials, name, email").in("meeting_id", mids),
    ]);
    // deno-lint-ignore no-explicit-any
    const live = open.filter((p: any) => (ms.data ?? []).some((m: any) => m.id === p.meeting_id && m.jobs?.status !== "archived"));
    if (!live.length) { await done(); continue; }
    const me = (ats.data ?? []).find((a: { email: string | null }) => a.email?.trim().toLowerCase() === email);
    const kinds = list.map((r) => r.kind);
    const overdue = kinds.includes("overdue");
    const isNew = kinds.includes("new");
    const day = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "no date");
    const lines = live
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"))
      // deno-lint-ignore no-explicit-any
      .map((p: any) => {
        // deno-lint-ignore no-explicit-any
        const m = (ms.data ?? []).find((x: any) => x.id === p.meeting_id);
        let t = String(p.text ?? "").trim() || "(no description)";
        // deno-lint-ignore no-explicit-any
        for (const a of (ats.data ?? []).filter((x: any) => x.meeting_id === p.meeting_id)) t = t.replace(new RegExp("@" + String(a.initials).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9])", "gi"), a.name);
        const late = p.due_date && p.due_date < new Date().toISOString().slice(0, 10);
        const cell = "padding:6px 8px;border-bottom:1px solid #e3e3ea;vertical-align:top;font-size:14px";
        return `<tr><td style="${cell}">${esc(t)}<br><span style="color:#777;font-size:12px">${esc(m?.jobs?.name ?? m?.project ?? "")}${m?.subtitle ? " · " + esc(m.subtitle) : ""}</span></td><td style="${cell};white-space:nowrap${late ? ";color:#c00;font-weight:600" : ""}">${day(p.due_date)}${late ? " (overdue)" : ""}</td></tr>`;
      })
      .join("");
    const raw = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const ins = await db.from("action_links").insert({ email, token_hash: hash });
    if (ins.error) continue;
    const link = `${appUrl}/a/${raw}`;
    const first = me?.name ? String(me.name).split(" ")[0] : "";
    // deno-lint-ignore no-explicit-any
    const hub = (ms.data ?? []).map((m: any) => m.jobs?.hub_url).find(Boolean);
    const n = live.length;
    const intro = overdue ? `You have ${n === 1 ? "an action" : n + " actions"} from our meetings that ${n === 1 ? "is" : "are"} now overdue, or soon will be.` : isNew ? `Here ${n === 1 ? "is the action" : "are the " + n + " actions"} given to you in the minutes of our meeting.` : `${n === 1 ? "An action" : n + " actions"} from our meetings ${n === 1 ? "is" : "are"} due soon.`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b;max-width:600px">
  <p>${first ? "Dear " + esc(first) + "," : "Hello,"}</p>
  <p>${esc(intro)}</p>
  <table style="border-collapse:collapse;width:100%;margin:0 0 16px"><tr><th style="text-align:left;padding:6px 8px;background:#eef3fa;font-size:13px">Action</th><th style="text-align:left;padding:6px 8px;background:#eef3fa;font-size:13px">Due</th></tr>${lines}</table>
  <p style="margin:0 0 24px">When one is done, open your list and tick it off: you don't need an account.</p>
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#2b2257;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open my actions</a></p>
  ${hubFooter(hub)}
  <p style="font-size:12px;color:#777;margin:0">This link is for you: please don't forward it. If it stops working, ask du Boulay Projects for a new one.</p>
</div>`;
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: `${overdue ? "Overdue: " : ""}${n === 1 ? "Your action" : "Your " + n + " actions"} from the meeting minutes`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: email } }] }, saveToSentItems: false }),
    });
    if (r.ok) { await done(); sent++; }
  }
  return sent;
}

// The Monday briefing (script 086): from 5am UK time on a Monday, each du Boulay person gets one friendly email with their week:
// what is overdue, what falls due in the next 7 days (from their bell) and what they closed last week. Once per person per week
// (weekly_briefings). Switched off by "email notifications" in My details.
const BRIEF_GREETINGS = [
  (n: string) => `Good morning${n ? ", " + n : ""}! Kettle on: here is your week.`,
  (n: string) => `Morning${n ? " " + n : ""}. Here is what the week looks like, before you have even sat down.`,
  (n: string) => `Happy Monday${n ? ", " + n : ""}! A quick look at what is ahead.`,
  (n: string) => `Morning${n ? " " + n : ""}, hard hat on: this is your week.`,
];
// deno-lint-ignore no-explicit-any
async function sendBriefings(db: any, getToken: () => Promise<string>, sender: string, appUrl: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  if (parts.weekday !== "Mon" || hour < 5 || hour >= 12) return 0;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const addDays = (iso: string, n: number) => new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
  const weekEnd = addDays(today, 6);
  const { data: people, error } = await db.from("profiles").select("id, email, full_name, email_notifications").ilike("email", "%@duboulay.co.uk");
  if (error || !people?.length) return 0;
  const { data: had, error: hadErr } = await db.from("weekly_briefings").select("profile_id").eq("week_start", today);
  if (hadErr) return 0; // script 086 not run
  const done = new Set((had ?? []).map((h: { profile_id: string }) => h.profile_id));
  // deno-lint-ignore no-explicit-any
  const todo = people.filter((p: any) => p.email && p.email_notifications !== false && !done.has(p.id)).slice(0, 25);
  const weekNo = Math.floor(new Date(today + "T00:00:00Z").getTime() / (7 * 86400000));
  const wk = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
  let sent = 0;
  for (const p of todo) {
    const [open, wins] = await Promise.all([
      db.from("notifications").select("title, due_date, link, kind").eq("profile_id", p.id).neq("status", "done").order("due_date", { nullsFirst: false }).limit(200),
      db.from("meeting_points").select("id", { count: "exact", head: true }).eq("owner_profile_id", p.id).eq("done", true).gte("done_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);
    const rows = (open.data ?? []) as { title: string; due_date: string | null; link: string | null }[];
    const overdue = rows.filter((r) => r.due_date && r.due_date < today);
    const soon = rows.filter((r) => r.due_date && r.due_date >= today && r.due_date <= weekEnd);
    const other = rows.length - overdue.length - soon.length;
    const closed = wins.count ?? 0;
    const first = p.full_name && p.full_name !== p.email ? String(p.full_name).split(" ")[0] : "";
    const table = (list: typeof rows, late: boolean) =>
      `<table style="border-collapse:collapse;width:100%;margin:0 0 6px">${list
        .slice(0, 8)
        .map((r) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #e3e3ea;font-size:14px"><a href="${esc(appUrl + (r.link ?? "/"))}" style="color:#1f1d2b;text-decoration:none">${esc(r.title)}</a></td><td style="padding:5px 8px;border-bottom:1px solid #e3e3ea;font-size:13px;white-space:nowrap;${late ? "color:#c00;font-weight:600" : "color:#555"}">${wk(r.due_date)}</td></tr>`)
        .join("")}</table>${list.length > 8 ? `<p style="margin:0 0 12px;font-size:12px;color:#777">…and ${list.length - 8} more in the app.</p>` : ""}`;
    const head = (t: string) => `<p style="margin:18px 0 6px;font-weight:700;color:#1f1246">${t}</p>`;
    const body = [
      overdue.length ? head(`Overdue (${overdue.length})`) + table(overdue, true) : "",
      soon.length ? head(`Due this week (${soon.length})`) + table(soon, false) : "",
      !overdue.length && !soon.length ? `<p>Nothing is overdue or due this week. A clear start.</p>` : "",
      other > 0 ? `<p style="font-size:13px;color:#555">Plus ${other} other thing${other === 1 ? "" : "s"} waiting with no date.</p>` : "",
      closed > 0 ? `<p style="margin-top:18px;padding:10px 12px;background:#e8f5ec;border-radius:8px">Last week you closed <b>${closed}</b> action${closed === 1 ? "" : "s"} from meetings. Nice work.</p>` : "",
    ].join("");
    // recorded first, so a slow run or a retry never sends it twice; removed again if the send fails
    const mark = await db.from("weekly_briefings").insert({ profile_id: p.id, week_start: today });
    if (mark.error) continue;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b;max-width:600px">
  <p style="font-size:17px;margin:0 0 4px">${esc(BRIEF_GREETINGS[weekNo % BRIEF_GREETINGS.length](first))}</p>
  ${body}
  <p style="margin:22px 0"><a href="${esc(appUrl)}/tasks" style="background:#2b2257;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open my tasks</a></p>
  <p style="font-size:12px;color:#777;margin:0">Sent every Monday morning. Switch it off with "email notifications" in My details.</p>
</div>`;
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: `Your week: ${overdue.length ? overdue.length + " overdue, " : ""}${soon.length} due this week`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: p.email } }] }, saveToSentItems: false }),
    });
    if (r.ok) sent++;
    else await db.from("weekly_briefings").delete().eq("profile_id", p.id).eq("week_start", today);
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
    try {
      await db.rpc("progress_report_reminders"); // script 064
    } catch {
      /* script 064 not run yet */
    }
    try {
      await db.rpc("hs_inspection_reminders"); // script 083: third-party inspections falling due, to the PMs
    } catch {
      /* script 083 not run yet */
    }

    try {
      await db.rpc("minutes_chase_tick"); // script 085: actions in the minutes coming due / overdue, to their owners
    } catch {
      /* script 085 not run yet */
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

    // outside people's RFI / submittal emails, each with their own private link (script 061)
    let outside = 0;
    try {
      outside = await sendOutside(db, token0, sender, appUrl);
    } catch (e) {
      console.warn("outside emails:", e instanceof Error ? e.message : e);
    }

    // outside owners' actions from the minutes (script 085)
    let actionMails = 0;
    try {
      actionMails = await sendActions(db, token0, sender, appUrl);
    } catch (e) {
      console.warn("action emails:", e instanceof Error ? e.message : e);
    }

    // Monday morning: everyone's week ahead (script 086)
    let briefings = 0;
    try {
      briefings = await sendBriefings(db, token0, sender, appUrl);
    } catch (e) {
      console.warn("monday briefing:", e instanceof Error ? e.message : e);
    }

    // the welcome email to anyone newly added to a job's project directory (script 078)
    let welcomes = 0;
    try {
      welcomes = await sendWelcome(db, token0, sender);
    } catch (e) {
      console.warn("welcome emails:", e instanceof Error ? e.message : e);
    }

    const since = new Date(Date.now() - 2 * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const cols = "id, profile_id, kind, title, detail, due_date, link, job_id, source_id, source_table";
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
    if (ready.length === 0) return reply({ ok: true, sent: 0, welcomes, outside, actionMails });

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
      let docs: { attach: unknown[]; left: string[] } = { attach: [], left: [] };
      if (n.kind === "requisition_update" && n.source_table === "requisitions" && n.source_id) {
        try {
          docs = await orderDocuments(db, n.source_id);
        } catch (e) {
          console.warn("order documents:", e instanceof Error ? e.message : e);
        }
      }
      const detail = [n.detail, docs.attach.length ? `${docs.attach.length} order document${docs.attach.length === 1 ? "" : "s"} attached.` : null, docs.left.length ? `Too large to attach (open them in the app): ${docs.left.join(", ")}` : null].filter(Boolean).join("\n") || null;
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: `DBP app: ${n.title}`,
            body: { contentType: "HTML", content: emailHtml(n.title, detail, link) },
            toRecipients: [{ emailAddress: { address: p.email } }],
            ...(docs.attach.length ? { attachments: docs.attach } : {}),
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
    return reply({ ok: failures.length === 0, sent, reports, outside, welcomes, failures });
  } catch (e) {
    return reply({ ok: false, detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
