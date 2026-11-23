// Supabase Edge Function "external": the ONLY way outside people (subcontractors, consultants, the client) reach RFIs and
// submittals (script 061). They have no login and no database access: this function checks who they are and returns
// just their own item. Deploy with "Verify JWT" OFF (they have no Supabase sign-in); it does its own checks.
//
// Two ways in:
//  - a private link per item per person  (https://<app>/r/<token>): the token is random, only its hash is stored, it expires
//    and DBP can revoke it
//  - an email code (https://<app>/external): enter an email address, get a 6-digit code by email, then see everything
//    addressed to that address. (Needs the Microsoft 365 email secrets, as send-emails.)
//
// What they can do: read their item and its files; an RFI assignee replies (text and files); a submittal reviewer records
// a response. Cc can only read. Nothing else exists here: no listing of other jobs, people or documents.
//
// Secrets: the server key is automatic. For the email code: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_SENDER.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
type DB = any;
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
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// outside people write plain text: it is stored as escaped paragraphs, never as HTML they supplied
const paragraphs = (t: string) =>
  t.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// no programs: drawings, documents, pictures, archives and emails only
const ALLOWED = new Set(["pdf", "doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx", "csv", "txt", "rtf", "png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "heic", "dwg", "dxf", "rvt", "ifc", "skp", "zip", "msg", "eml", "odt", "ods"]);

// ---------- rate limiting ----------
async function limit(db: DB, kind: string, key: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count } = await db.from("external_attempts").select("id", { count: "exact", head: true }).eq("kind", kind).eq("key", key).gte("at", since);
  if ((count ?? 0) >= max) throw new Fail(429, "Too many attempts. Please wait a while and try again.");
  await db.from("external_attempts").insert({ kind, key });
}

// ---------- who is asking ----------
interface Ctx {
  email: string | null;
  kind: "rfi" | "submittal";
  itemId: string;
  personRow: string; // rfi_people / submittal_people id
  role: string; // assignee | reviewer | cc
  name: string;
  company: string;
  linkId: string | null;
}
const table = (kind: string) => (kind === "rfi" ? "rfi_people" : "submittal_people");
const itemCol = (kind: string) => (kind === "rfi" ? "rfi_id" : "submittal_id");

async function person(db: DB, kind: "rfi" | "submittal", personRow: string) {
  const { data: p, error: perr } = await db.from(table(kind)).select(`id, role, directory_id, ${itemCol(kind)}`).eq("id", personRow).maybeSingle();
  if (perr) {
    console.error("external: person lookup failed:", perr.message);
    throw new Fail(500, `The server couldn't check this link. (code 5: ${String(perr.message).slice(0, 120)})`);
  }
  if (!p || !p.directory_id) throw new Fail(404, "This link is no longer valid. (code 6: the person was removed from the item)");
  const { data: d } = await db.from("job_directory").select("contact_id, company_id").eq("id", p.directory_id).maybeSingle();
  const [c, co] = await Promise.all([
    d?.contact_id ? db.from("contacts").select("name, email").eq("id", d.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    d?.company_id ? db.from("companies").select("name, email").eq("id", d.company_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const name = c.data?.name ?? co.data?.name ?? "You";
  return { role: p.role as string, itemId: p[itemCol(kind)] as string, name, company: (co.data?.name as string) ?? "", email: ((c.data?.email || co.data?.email) as string | null) ?? null };
}

async function bySession(db: DB, session: string, kind: string, id: string): Promise<Ctx> {
  if (!TOKEN.test(session) || (kind !== "rfi" && kind !== "submittal") || !/^[0-9a-f-]{36}$/.test(id)) throw new Fail(401, "Please sign in again.");
  const { data: s } = await db.from("external_sessions").select("email, expires_at").eq("token_hash", await sha256(session)).maybeSingle();
  if (!s || new Date(s.expires_at) < new Date()) throw new Fail(401, "Your sign-in has expired. Please sign in again.");
  const items = await findAccess(db, s.email);
  // if the same address is on the item twice (e.g. assignee and Cc), the role that can act wins
  const mine = items.filter((i) => i.kind === kind && i.itemId === id);
  const hit = mine.find((i) => i.role !== "cc") ?? mine[0];
  if (!hit) throw new Fail(404, "That item isn't available to you.");
  const p = await person(db, hit.kind, hit.personRow);
  return { email: s.email, kind: hit.kind, itemId: id, personRow: hit.personRow, role: p.role, name: p.name, company: p.company, linkId: null };
}
async function byToken(db: DB, token: string, ip: string, kind?: string, id?: string): Promise<Ctx> {
  // (the short codes in brackets say which check failed, to help find a problem; they reveal nothing about anyone's data)
  if (!TOKEN.test(token)) {
    await limit(db, "badtoken", ip, 30, 60);
    throw new Fail(404, "This link isn't valid. (code 1: the link looks cut off or changed; copy the whole link)");
  }
  const hash = await sha256(token);
  const { data: l, error: lerr } = await db.from("external_links").select("id, kind, item_id, person_id, email, expires_at, revoked_at, use_count").eq("token_hash", hash).maybeSingle();
  if (lerr) {
    console.error("external: link lookup failed:", lerr.message);
    throw new Fail(500, `The server couldn't check this link. (code 3: ${String(lerr.message).slice(0, 120)})`);
  }
  if (!l) {
    await limit(db, "badtoken", ip, 30, 60);
    console.warn("external: no link with that token (length " + token.length + ")");
    throw new Fail(404, "This link isn't valid. (code 2: no such link: it may not have been copied in full)");
  }
  if (l.revoked_at) throw new Fail(410, "This link has been withdrawn. Please ask du Boulay Projects for a new one.");
  if (new Date(l.expires_at) < new Date()) throw new Fail(410, "This link has expired. Please ask du Boulay Projects for a new one.");
  const p = await person(db, l.kind, l.person_id);
  if (p.itemId !== l.item_id) throw new Fail(404, "This link isn't valid. (code 4: it points at a different item)");
  await db.from("external_links").update({ last_used_at: new Date().toISOString(), use_count: (l.use_count ?? 0) + 1 }).eq("id", l.id);
  // the link was made for one person (their email): it also opens their other RFIs and submittals
  if (kind && id && !(kind === l.kind && id === l.item_id)) {
    if (!l.email || (kind !== "rfi" && kind !== "submittal") || !/^[0-9a-f-]{36}$/.test(id)) throw new Fail(404, "That item isn't available to you.");
    const mine = (await findAccess(db, l.email)).filter((i) => i.kind === kind && i.itemId === id);
    const hit = mine.find((i) => i.role !== "cc") ?? mine[0];
    if (!hit) throw new Fail(404, "That item isn't available to you.");
    const q = await person(db, hit.kind, hit.personRow);
    return { email: l.email, kind: hit.kind, itemId: id, personRow: hit.personRow, role: q.role, name: q.name, company: q.company, linkId: l.id };
  }
  return { email: l.email, kind: l.kind, itemId: l.item_id, personRow: l.person_id, role: p.role, name: p.name, company: p.company, linkId: l.id };
}
async function resolve(db: DB, b: Record<string, string>, ip: string) {
  return b.token ? byToken(db, String(b.token), ip, b.kind ? String(b.kind) : undefined, b.id ? String(b.id) : undefined) : bySession(db, String(b.session ?? ""), String(b.kind ?? ""), String(b.id ?? ""));
}

// every RFI / submittal addressed to this email address (contacts, or a company's own address)
async function findAccess(db: DB, email: string) {
  const e = email.trim().toLowerCase();
  const [c, co] = await Promise.all([db.from("contacts").select("id, email").ilike("email", e), db.from("companies").select("id, email").ilike("email", e)]);
  const cIds = (c.data ?? []).filter((x: { email: string }) => x.email?.trim().toLowerCase() === e).map((x: { id: string }) => x.id);
  const coIds = (co.data ?? []).filter((x: { email: string }) => x.email?.trim().toLowerCase() === e).map((x: { id: string }) => x.id);
  const filters: string[] = [];
  if (cIds.length) filters.push(`contact_id.in.(${cIds.join(",")})`);
  if (coIds.length) filters.push(`and(contact_id.is.null,company_id.in.(${coIds.join(",")}))`);
  if (!filters.length) return [];
  const { data: dir } = await db.from("job_directory").select("id").or(filters.join(","));
  const dirIds = (dir ?? []).map((d: { id: string }) => d.id);
  if (!dirIds.length) return [];
  const [rp, sp] = await Promise.all([db.from("rfi_people").select("id, rfi_id, role").in("directory_id", dirIds), db.from("submittal_people").select("id, submittal_id, role").in("directory_id", dirIds)]);
  const out: { kind: "rfi" | "submittal"; itemId: string; personRow: string; role: string }[] = [];
  for (const r of rp.data ?? []) out.push({ kind: "rfi", itemId: r.rfi_id, personRow: r.id, role: r.role });
  for (const s of sp.data ?? []) out.push({ kind: "submittal", itemId: s.submittal_id, personRow: s.id, role: s.role });
  return out;
}

// ---------- the items, as outside people see them ----------
const RFI_VISIBLE = ["open", "answered", "closed"];
const SUB_VISIBLE = ["out", "approved", "approved_noted", "revise", "rejected"];

// where an item stands for THIS person: with them (they need to act), with DBP (they have answered), for information (copied in), or finished
function stateOf(kind: string, role: string, status: string) {
  if (kind === "rfi") {
    if (status === "closed") return "done";
    if (role === "assignee") return status === "open" ? "with_you" : "with_dbp";
    return "fyi";
  }
  if (status !== "out") return "done";
  return role === "reviewer" ? "with_you" : "fyi";
}
// a reference that is unique across projects, to quote over the phone: 2611_FISL_RFI_004
// deno-lint-ignore no-explicit-any
const refOf = (kind: string, number: number, j: any) => `${j?.job_no ?? ""}_${j?.code ?? ""}_${kind === "rfi" ? "RFI" : "SUB"}_${String(number).padStart(3, "0")}`;
const plain = (h: string | null, n = 170) => {
  const t = String(h ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

async function names(db: DB, ids: (string | null)[]) {
  const u = [...new Set(ids.filter(Boolean))] as string[];
  if (!u.length) return new Map<string, string>();
  const { data } = await db.from("profiles").select("id, full_name").in("id", u);
  return new Map<string, string>((data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "du Boulay Projects"]));
}

async function viewRfi(db: DB, ctx: Ctx) {
  const { data: r } = await db.from("rfis").select("id, job_id, number, title, question, status, due_date, trade, manager_id, jobs(name, status, job_no, code)").eq("id", ctx.itemId).maybeSingle();
  if (!r || !r.job_id || !RFI_VISIBLE.includes(r.status)) throw new Fail(404, "This RFI isn't available.");
  const [{ data: resp }, { data: files }] = await Promise.all([
    db.from("rfi_responses").select("id, kind, body, author_id, author_name, created_at").eq("rfi_id", r.id).neq("kind", "note").order("created_at"),
    db.from("rfi_files").select("id, response_id, name").eq("rfi_id", r.id).order("created_at"),
  ]);
  const nm = await names(db, [r.manager_id, ...(resp ?? []).map((x: { author_id: string | null }) => x.author_id)]);
  return {
    kind: "rfi",
    id: r.id,
    ref: refOf("rfi", r.number, r.jobs),
    project: r.jobs?.name ?? "",
    number: r.number,
    title: r.title,
    body: r.question,
    status: r.status,
    due_date: r.due_date,
    trade: r.trade,
    manager: r.manager_id ? nm.get(r.manager_id) : null,
    you: { name: ctx.name, company: ctx.company, role: ctx.role },
    state: stateOf("rfi", ctx.role, r.status),
    can_act: ctx.role === "assignee" && (r.status === "open" || r.status === "answered"),
    responses: (resp ?? []).map((x: { id: string; kind: string; body: string; author_id: string | null; author_name: string | null; created_at: string }) => ({
      id: x.id,
      kind: x.kind,
      body: x.body,
      author: x.author_name || (x.author_id ? nm.get(x.author_id) : null) || "du Boulay Projects",
      at: x.created_at,
      files: (files ?? []).filter((f: { response_id: string | null }) => f.response_id === x.id).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name })),
    })),
    files: (files ?? []).filter((f: { response_id: string | null }) => !f.response_id).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name })),
  };
}

async function viewSubmittal(db: DB, ctx: Ctx) {
  const { data: s } = await db.from("submittals").select("id, job_id, number, title, description, type, trade, status, current_rev, due_date, manager_id, jobs(name, status, job_no, code)").eq("id", ctx.itemId).maybeSingle();
  if (!s || !SUB_VISIBLE.includes(s.status)) throw new Fail(404, "This submittal isn't available.");
  const [{ data: revs }, { data: files }] = await Promise.all([
    db.from("submittal_revisions").select("id, rev, submitted_on, due_date, outcome, response_notes, responded_by, responded_on").eq("submittal_id", s.id).order("rev"),
    db.from("submittal_files").select("id, revision_id, kind, name").eq("submittal_id", s.id).order("created_at"),
  ]);
  const nm = await names(db, [s.manager_id]);
  return {
    kind: "submittal",
    id: s.id,
    ref: refOf("submittal", s.number, s.jobs),
    project: s.jobs?.name ?? "",
    number: s.number,
    title: s.title,
    body: s.description,
    type: s.type,
    trade: s.trade,
    status: s.status,
    current_rev: s.current_rev,
    due_date: s.due_date,
    manager: s.manager_id ? nm.get(s.manager_id) : null,
    you: { name: ctx.name, company: ctx.company, role: ctx.role },
    state: stateOf("submittal", ctx.role, s.status),
    can_act: ctx.role === "reviewer" && s.status === "out",
    revisions: (revs ?? []).map((r: { id: string }) => ({ ...r, files: (files ?? []).filter((f: { revision_id: string }) => f.revision_id === r.id).map((f: { id: string; kind: string; name: string }) => ({ id: f.id, name: f.name, kind: f.kind })) })),
  };
}

// ---------- files ----------
function fileOk(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED.has(ext);
}
async function fileUrl(db: DB, ctx: Ctx, fileId: string) {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Fail(404, "File not found.");
  if (ctx.kind === "rfi") {
    const { data: f } = await db.from("rfi_files").select("path, name, response_id").eq("id", fileId).eq("rfi_id", ctx.itemId).maybeSingle();
    if (!f) throw new Fail(404, "File not found.");
    if (f.response_id) {
      const { data: r } = await db.from("rfi_responses").select("kind").eq("id", f.response_id).maybeSingle();
      if (!r || r.kind === "note") throw new Fail(404, "File not found.");
    }
    const s = await db.storage.from("rfis").createSignedUrl(f.path, 600, { download: f.name });
    if (s.error) throw new Fail(500, "Couldn't open that file.");
    return s.data.signedUrl;
  }
  const { data: f } = await db.from("submittal_files").select("path, name").eq("id", fileId).eq("submittal_id", ctx.itemId).maybeSingle();
  if (!f) throw new Fail(404, "File not found.");
  const s = await db.storage.from("submittals").createSignedUrl(f.path, 600, { download: f.name });
  if (s.error) throw new Fail(500, "Couldn't open that file.");
  return s.data.signedUrl;
}
async function checkFiles(ctx: Ctx, files: unknown) {
  const list = Array.isArray(files) ? files.slice(0, 10) : [];
  const out: { path: string; name: string }[] = [];
  for (const f of list as { path?: string; name?: string }[]) {
    const path = String(f?.path ?? "");
    const name = String(f?.name ?? "").slice(0, 200);
    if (!path.startsWith(`${ctx.itemId}/ext-`) || path.includes("..") || !name || !fileOk(name)) throw new Fail(400, "One of the files isn't allowed.");
    out.push({ path, name });
  }
  return out;
}

// ---------- mail (the sign-in code) ----------
async function sendMail(to: string, subject: string, html: string) {
  const tenant = Deno.env.get("MS_TENANT_ID"), client = Deno.env.get("MS_CLIENT_ID"), secret = Deno.env.get("MS_CLIENT_SECRET"), sender = Deno.env.get("MAIL_SENDER");
  if (!tenant || !client || !secret || !sender) return false;
  const t = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await t.json();
  if (!t.ok) return false;
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${j.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }),
  });
  return r.ok;
}

// the RFIs and submittals an outside person can see (those addressed to them), for the list pages
async function listItems(db: DB, acc: { kind: "rfi" | "submittal"; itemId: string; personRow: string; role: string }[]) {
  const rfiIds = acc.filter((a) => a.kind === "rfi").map((a) => a.itemId);
  const subIds = acc.filter((a) => a.kind === "submittal").map((a) => a.itemId);
  const [rf, sb] = await Promise.all([
    rfiIds.length ? db.from("rfis").select("id, job_id, number, title, question, trade, status, due_date, jobs(name, job_no, code)").in("id", rfiIds).in("status", RFI_VISIBLE) : Promise.resolve({ data: [] }),
    subIds.length ? db.from("submittals").select("id, job_id, number, title, description, trade, status, due_date, jobs(name, job_no, code)").in("id", subIds).in("status", SUB_VISIBLE) : Promise.resolve({ data: [] }),
  ]);
  // how many files each has, for the paperclip (internal notes' files are not counted: outside people can't see them)
  const [rff, sbf, notes] = await Promise.all([
    rfiIds.length ? db.from("rfi_files").select("rfi_id, response_id").in("rfi_id", rfiIds) : Promise.resolve({ data: [] }),
    subIds.length ? db.from("submittal_files").select("submittal_id").in("submittal_id", subIds) : Promise.resolve({ data: [] }),
    rfiIds.length ? db.from("rfi_responses").select("id").in("rfi_id", rfiIds).eq("kind", "note") : Promise.resolve({ data: [] }),
  ]);
  const noteIds = new Set((notes.data ?? []).map((n: { id: string }) => n.id));
  const count: Record<string, number> = {};
  for (const f of rff.data ?? []) if (!f.response_id || !noteIds.has(f.response_id)) count[f.rfi_id] = (count[f.rfi_id] ?? 0) + 1;
  for (const f of sbf.data ?? []) count[f.submittal_id] = (count[f.submittal_id] ?? 0) + 1;
  const roleOf = (k: string, id: string) => acc.find((a) => a.kind === k && a.itemId === id)?.role;
  const items = [
    // deno-lint-ignore no-explicit-any
    ...(rf.data ?? []).filter((r: any) => r.job_id).map((r: any) => ({ kind: "rfi", id: r.id, ref: refOf("rfi", r.number, r.jobs), number: r.number, title: r.title, status: r.status, due_date: r.due_date, project: r.jobs?.name ?? "", snippet: plain(r.question), trade: r.trade, files: count[r.id] ?? 0, state: stateOf("rfi", roleOf("rfi", r.id) ?? "cc", r.status), act: stateOf("rfi", roleOf("rfi", r.id) ?? "cc", r.status) === "with_you" })),
    // deno-lint-ignore no-explicit-any
    ...(sb.data ?? []).map((r: any) => ({ kind: "submittal", id: r.id, ref: refOf("submittal", r.number, r.jobs), number: r.number, title: r.title, status: r.status, due_date: r.due_date, project: r.jobs?.name ?? "", snippet: plain(r.description), trade: r.trade, files: count[r.id] ?? 0, state: stateOf("submittal", roleOf("submittal", r.id) ?? "cc", r.status), act: stateOf("submittal", roleOf("submittal", r.id) ?? "cc", r.status) === "with_you" })),
  ];
  return items;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ ok: false, error: "Not found." }, 404);
  try {
    const key = serverKey();
    if (!key) return reply({ ok: false, error: "Not available." }, 503);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown> & Record<string, string>;
    const action = String(b.action ?? "");
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const ipHash = (await sha256(ip)).slice(0, 16);
    const log = (c: Ctx | null, act: string, email?: string | null) =>
      db.from("external_events").insert({ link_id: c?.linkId ?? null, email: c?.email ?? email ?? null, action: act, item_kind: c?.kind ?? null, item_id: c?.itemId ?? null, ip_hash: ipHash });

    // ----- email-code sign-in -----
    if (action === "request_code") {
      const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
      if (!EMAIL.test(email)) return reply({ ok: false, error: "Please enter a valid email address." }, 400);
      await limit(db, "code-ip", ip, 20, 60);
      await limit(db, "code-email", email, 5, 60);
      if (!Deno.env.get("MS_CLIENT_ID") || !Deno.env.get("MAIL_SENDER")) return reply({ ok: false, error: "Email sign-in isn't switched on yet. Please use the link in your email from du Boulay Projects." }, 503);
      // the same answer whether or not the address is known, so nobody can find out who is on a job
      if ((await findAccess(db, email)).length) {
        const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        await db.from("external_codes").delete().eq("email", email);
        await db.from("external_codes").insert({ email, code_hash: await sha256(`${code}:${email}`) });
        await sendMail(email, "Your du Boulay Projects sign-in code", `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f1d2b"><p>Your sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It works for 10 minutes. If you didn't ask for it, ignore this email.</p></div>`);
      }
      db.rpc("external_cleanup").then(() => {}, () => {});
      return reply({ ok: true });
    }
    if (action === "verify_code") {
      const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
      const code = String(b.code ?? "").trim();
      if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) return reply({ ok: false, error: "That code isn't right." }, 400);
      await limit(db, "verify-ip", ip, 40, 60);
      await limit(db, "verify-email", email, 10, 60);
      const { data: c } = await db.from("external_codes").select("id, code_hash, attempts, expires_at").eq("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!c || new Date(c.expires_at) < new Date() || c.attempts >= 5) return reply({ ok: false, error: "That code isn't right, or it has expired. Ask for a new one." }, 401);
      if (!same(c.code_hash, await sha256(`${code}:${email}`))) {
        await db.from("external_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id);
        return reply({ ok: false, error: "That code isn't right, or it has expired. Ask for a new one." }, 401);
      }
      await db.from("external_codes").delete().eq("email", email);
      const session = rand(32);
      await db.from("external_sessions").insert({ token_hash: await sha256(session), email });
      await log(null, "sign_in", email);
      return reply({ ok: true, session });
    }
    if (action === "list") {
      const sess = String(b.session ?? "");
      if (!TOKEN.test(sess)) throw new Fail(401, "Please sign in again.");
      const { data: s } = await db.from("external_sessions").select("email, expires_at").eq("token_hash", await sha256(sess)).maybeSingle();
      if (!s || new Date(s.expires_at) < new Date()) throw new Fail(401, "Your sign-in has expired. Please sign in again.");
      return reply({ ok: true, email: s.email, items: await listItems(db, await findAccess(db, s.email)) });
    }
    if (action === "list_link") {
      // everything for the person a private link was made for
      const c = await byToken(db, String(b.token ?? ""), ip);
      await log(c, "list");
      const acc = c.email ? await findAccess(db, c.email) : [{ kind: c.kind, itemId: c.itemId, personRow: c.personRow, role: c.role }];
      return reply({ ok: true, email: c.email, name: c.name, focus: { kind: c.kind, id: c.itemId }, items: await listItems(db, acc) });
    }

    // ----- one item: by private link or by sign-in -----
    const ctx = await resolve(db, b as Record<string, string>, ip);
    if (action === "view") {
      await log(ctx, "view");
      return reply({ ok: true, item: ctx.kind === "rfi" ? await viewRfi(db, ctx) : await viewSubmittal(db, ctx) });
    }
    if (action === "file_url") return reply({ ok: true, url: await fileUrl(db, ctx, String(b.file_id ?? "")) });

    // anything that changes something needs the right role and an item that is still open
    if (action === "upload_url") {
      const item = ctx.kind === "rfi" ? await viewRfi(db, ctx) : await viewSubmittal(db, ctx);
      if (!item.can_act) throw new Fail(403, "You can't add files to this.");
      await limit(db, "upload", ctx.personRow, 40, 60);
      const filename = String(b.filename ?? "").slice(0, 200);
      if (!fileOk(filename)) throw new Fail(400, "That type of file isn't allowed. Documents, drawings, pictures and zip files are.");
      const safe = filename.replace(/[^\w.\- ()]+/g, "_");
      const path = `${ctx.itemId}/ext-${Date.now()}-${rand(4)}-${safe}`;
      const s = await db.storage.from(ctx.kind === "rfi" ? "rfis" : "submittals").createSignedUploadUrl(path);
      if (s.error) throw new Fail(500, "Couldn't start the upload.");
      return reply({ ok: true, path, url: s.data.signedUrl });
    }
    if (action === "reply" && ctx.kind === "rfi") {
      const item = await viewRfi(db, ctx);
      if (!item.can_act) throw new Fail(403, "This RFI can't be replied to.");
      const text = String(b.text ?? "").slice(0, 20000);
      const files = await checkFiles(ctx, b.files);
      if (!text.trim() && !files.length) throw new Fail(400, "Please write a reply or attach a file.");
      await limit(db, "reply", ctx.personRow, 30, 60);
      const author = ctx.company && ctx.company !== ctx.name ? `${ctx.name} (${ctx.company})` : ctx.name;
      const r = await db.from("rfi_responses").insert({ rfi_id: ctx.itemId, kind: "reply", body: paragraphs(text), author_id: null, author_name: author }).select("id").single();
      if (r.error) throw new Fail(500, "Couldn't save your reply.");
      for (const f of files) await db.from("rfi_files").insert({ rfi_id: ctx.itemId, response_id: r.data.id, name: f.name, path: f.path, file_name: f.name, uploaded_by: null });
      await log(ctx, "reply");
      return reply({ ok: true });
    }
    if (action === "respond" && ctx.kind === "submittal") {
      const item = await viewSubmittal(db, ctx);
      if (!item.can_act) throw new Fail(403, "This submittal isn't waiting for your response.");
      const outcome = String(b.outcome ?? "");
      if (!["approved", "approved_noted", "revise", "rejected"].includes(outcome)) throw new Fail(400, "Please choose an outcome.");
      const text = String(b.text ?? "").slice(0, 20000);
      if ((outcome === "revise" || outcome === "rejected" || outcome === "approved_noted") && !text.trim()) throw new Fail(400, "Please say what needs to change.");
      const files = await checkFiles(ctx, b.files);
      await limit(db, "respond", ctx.personRow, 20, 60);
      const author = ctx.company && ctx.company !== ctx.name ? `${ctx.name} (${ctx.company})` : ctx.name;
      const rv = await db.from("submittal_revisions").select("id").eq("submittal_id", ctx.itemId).eq("rev", item.current_rev).maybeSingle();
      if (!rv.data) throw new Fail(404, "Couldn't find the revision.");
      const upd = await db.from("submittal_revisions").update({ outcome, response_notes: paragraphs(text), responded_by: author, responded_on: new Date().toISOString().slice(0, 10) }).eq("id", rv.data.id);
      if (upd.error) throw new Fail(500, "Couldn't save your response.");
      for (const f of files) await db.from("submittal_files").insert({ submittal_id: ctx.itemId, revision_id: rv.data.id, kind: "response", name: f.name, path: f.path, file_name: f.name, uploaded_by: null });
      // only if it is still out (two people answering at once: the first wins)
      const st = await db.from("submittals").update({ status: outcome }).eq("id", ctx.itemId).eq("status", "out").select("id");
      if (!st.data?.length) throw new Fail(409, "Someone has already responded to this submittal.");
      await log(ctx, "respond");
      return reply({ ok: true });
    }
    return reply({ ok: false, error: "Not found." }, 404);
  } catch (e) {
    if (e instanceof Fail) return reply({ ok: false, error: e.message }, e.status);
    console.error("external:", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
